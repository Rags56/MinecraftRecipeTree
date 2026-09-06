import {link, rename, unlink, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname, join, resolve, sep} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath} from 'node:url';
import {requireExporterReleaseManifest} from '../src/data/exporterReleases.ts';
import {
  DEFAULT_EXPORTER_ACCEPTANCE_ROOT,
  DEFAULT_EXPORTER_WORKSPACE_ROOT,
  MAX_EXPORTER_MANIFEST_BYTES,
  exporterReleaseDefinitionForId,
  readVerifiedExporterJar,
  readVerifiedRegularFile,
  requireAcceptedExporterRelease,
  resolveExporterReleaseSourcePath,
} from './exporter-release-acceptance.mjs';
import {
  DEFAULT_EXPORTER_PUBLIC_ROOT,
  requireRealExporterPublicRoot,
  withExporterReleaseManifestLock,
} from './exporter-release-lock.mjs';

export {withExporterReleaseManifestLock} from './exporter-release-lock.mjs';

export const EXPORTER_RELEASE_MANIFEST_FORMAT = 'mrt-exporter-releases-v2';
const DEFAULT_WORKSPACE_ROOT = DEFAULT_EXPORTER_WORKSPACE_ROOT;
const DEFAULT_PUBLIC_ROOT = DEFAULT_EXPORTER_PUBLIC_ROOT;
const RELEASE_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export const EXPORTER_RELEASE_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'neoforge-jei-1.21.1',
    minecraftVersion: '1.21.1',
    recipeViewer: 'JEI 19',
    loader: 'NeoForge 21.1',
    version: '1.0.0',
    source: 'recipe-export-mod-1.21.1/build/libs/jeiexport-1.0.0.jar',
    filename: 'recipe-tree-exporter-neoforge-1.21.1-1.0.0.jar',
    qualityProfiles: Object.freeze(['generic-jei-1.21.1']),
    artifactProvenance: null,
    acceptanceCorpora: Object.freeze({'generic-jei-1.21.1': null}),
    compatibility: 'NeoForge 21.1.x with JEI 19.21–19.x',
  }),
  Object.freeze({
    id: 'forge-jei-1.20.1',
    minecraftVersion: '1.20.1',
    recipeViewer: 'JEI 15',
    loader: 'Forge 47',
    version: '1.1.0',
    source: 'recipe-export-mod-1.20.1/build/libs/jeiexport-1.1.0.jar',
    filename: 'recipe-tree-exporter-forge-1.20.1-1.1.0.jar',
    qualityProfiles: Object.freeze(['generic-jei-1.20.1']),
    artifactProvenance: null,
    acceptanceCorpora: Object.freeze({'generic-jei-1.20.1': null}),
    compatibility: 'Forge 47.1–47.x with JEI 15.2–15.x',
  }),
  Object.freeze({
    id: 'forge-rei-1.18.2',
    minecraftVersion: '1.18.2',
    recipeViewer: 'REI 8',
    loader: 'Forge 40',
    version: '1.0.52',
    source: 'recipe-export-mod-1.18.2/build/libs/recipe-export-mod-1.18.2-1.0.52.jar',
    filename: 'recipe-tree-exporter-forge-1.18.2-1.0.52.jar',
    qualityProfiles: Object.freeze(['multiblock-madness-2-1.18.2']),
    artifactProvenance: Object.freeze({
      format: 'mrt-exporter-build-v1',
      exporterId: 'forge-rei-1.18.2',
      minecraftVersion: '1.18.2',
    }),
    acceptanceCorpora: Object.freeze({
      'multiblock-madness-2-1.18.2': Object.freeze({
        items: 68551,
        recipes: 99908,
        categories: 333,
        mobs: 0,
        blockDrops: 0,
      }),
    }),
    compatibility: 'Forge 40 with REI 8.4.x',
  }),
  Object.freeze({
    id: 'forge-hei-1.12.2',
    minecraftVersion: '1.12.2',
    recipeViewer: 'HEI/JEI 4',
    loader: 'Forge 14.23.5',
    version: '1.2.0-beta.128',
    source: 'recipe-export-mod-1.12.2/build/libs/recipe-export-mod-1.12.2-1.2.0-beta.128.jar',
    filename: 'recipe-tree-exporter-forge-1.12.2-1.2.0-beta.128.jar',
    qualityProfiles: Object.freeze(['meatballcraft-1.12.2', 'multiblock-madness-1.12.2']),
    artifactProvenance: Object.freeze({
      format: 'mrt-exporter-build-v1',
      exporterId: 'forge-hei-1.12.2',
      minecraftVersion: '1.12.2',
    }),
    acceptanceCorpora: Object.freeze({
      'meatballcraft-1.12.2': Object.freeze({
        items: 196920,
        recipes: 376179,
        categories: 680,
        mobs: 0,
        blockDrops: 0,
      }),
      'multiblock-madness-1.12.2': Object.freeze({
        items: 88262,
        recipes: 107814,
        categories: 378,
        mobs: 0,
        blockDrops: 0,
      }),
    }),
    compatibility: 'Forge 14.23.5 with JEI/HEI 4.12.0.214–4.x',
  }),
  Object.freeze({
    id: 'forge-nei-gtnh-1.7.10',
    minecraftVersion: '1.7.10',
    recipeViewer: 'NEI 2.8.44-GTNH',
    loader: 'Forge 10.13.4.1614',
    version: '1.0.154',
    source: 'recipe-export-mod-1.7.10/build/libs/recipe-tree-gtnh-nei-exporter-1.0.154.jar',
    filename: 'recipe-tree-exporter-gtnh-1.7.10-1.0.154.jar',
    qualityProfiles: Object.freeze(['gtnh-1.7.10']),
    artifactProvenance: Object.freeze({
      format: 'mrt-exporter-build-v1',
      exporterId: 'forge-nei-gtnh-1.7.10',
      minecraftVersion: '1.7.10',
    }),
    acceptanceCorpora: Object.freeze({
      'gtnh-1.7.10': Object.freeze({
        items: 143882,
        recipes: 568820,
        categories: 287,
        mobs: 0,
        blockDrops: 0,
      }),
    }),
    compatibility: 'GT New Horizons 2.8.4 with NEI 2.8.44-GTNH',
  }),
]);

async function readVerifiedManifest(path, label) {
  const {bytes} = await readVerifiedRegularFile(path, label, {
    minimumBytes: 2,
    maximumBytes: MAX_EXPORTER_MANIFEST_BYTES,
  });
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`, {cause: error});
  }
  return Object.freeze({bytes, manifest: requireExporterReleaseManifest(parsed)});
}

async function atomicWrite(path, bytes) {
  const temporary = join(dirname(path), `.${path.split(sep).at(-1)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await writeFile(temporary, bytes, {flag: 'wx'});
    await rename(temporary, path);
  } catch (error) {
    try {
      await unlink(temporary);
    } catch (cleanupError) {
      if (cleanupError?.code !== 'ENOENT') {
        throw new AggregateError(
          [error, cleanupError],
          `Atomic write failed and temporary cleanup also failed: ${temporary}.`,
        );
      }
    }
    throw error;
  }
}

export async function atomicWriteNew(path, bytes, testOnlyOperations = undefined) {
  const operations = testOnlyOperations ?? {link, unlink, writeFile};
  const temporary = join(dirname(path), `.${path.split(sep).at(-1)}.${process.pid}.${Date.now()}.tmp`);
  let targetCreated = false;
  try {
    // Publishing a hard link is an atomic no-replace operation. Removing the temporary name
    // immediately returns the immutable release JAR to a single-link regular file.
    await operations.writeFile(temporary, bytes, {flag: 'wx'});
    await operations.link(temporary, path);
    targetCreated = true;
    await operations.unlink(temporary);
  } catch (error) {
    const rollbackErrors = [];
    if (targetCreated) {
      try {
        await operations.unlink(path);
        targetCreated = false;
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    try {
      await operations.unlink(temporary);
    } catch (rollbackError) {
      if (rollbackError?.code !== 'ENOENT') {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        `Immutable JAR creation failed and cleanup was incomplete for ${path}.`,
      );
    }
    throw error;
  }
}

async function optionalVerifiedJar(path, label) {
  try {
    return await readVerifiedExporterJar(path, label);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function validateGeneratedAt(generatedAt) {
  if (
    typeof generatedAt !== 'string' ||
    !Number.isFinite(Date.parse(generatedAt)) ||
    new Date(generatedAt).toISOString() !== generatedAt
  ) {
    throw new Error('generatedAt must be a canonical ISO timestamp.');
  }
}

async function requireAcceptance({
  definition,
  sourceBytes,
  acceptanceRoot,
  logger,
  testOnlyBypassAcceptanceReceipt,
}) {
  if (testOnlyBypassAcceptanceReceipt === true) {
    logger.warn(
      `[exporter-release] TEST-ONLY acceptance receipt bypass used for ${definition.id}; production CLI calls cannot enable this option.`,
    );
    return Object.freeze([]);
  }
  const receipts = [];
  for (const qualityProfile of definition.qualityProfiles ?? []) {
    try {
      receipts.push(
        await requireAcceptedExporterRelease({
          definition,
          sourceBytes,
          qualityProfile,
          acceptanceRoot,
          logger,
        }),
      );
    } catch (error) {
      throw new Error(
        `Exporter release ${definition.id} is not fully accepted; profile ${qualityProfile} failed: ${error.message}`,
        {cause: error},
      );
    }
  }
  if (receipts.length !== definition.qualityProfiles?.length || receipts.length === 0) {
    throw new Error(
      `Exporter release ${definition.id} has an invalid or incomplete advertised profile set.`,
    );
  }
  return Object.freeze(receipts);
}

function releaseForBytes(definition, bytes) {
  const {
    source: _source,
    artifactProvenance: _artifactProvenance,
    acceptanceCorpora: _acceptanceCorpora,
    ...publicDefinition
  } = definition;
  return Object.freeze({
    ...publicDefinition,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
  });
}

function bytesMatchRelease(bytes, release) {
  return (
    bytes.length === release.bytes &&
    createHash('sha256').update(bytes).digest('hex') === release.sha256
  );
}

function exactJsonEqual(left, right) {
  return isDeepStrictEqual(left, right);
}

export async function packageExporterReleases({
  workspaceRoot = DEFAULT_WORKSPACE_ROOT,
  publicRoot = DEFAULT_PUBLIC_ROOT,
  acceptanceRoot = DEFAULT_EXPORTER_ACCEPTANCE_ROOT,
  definitions = EXPORTER_RELEASE_DEFINITIONS,
  generatedAt = new Date().toISOString(),
  logger = console,
  testOnlyBypassAcceptanceReceipt = false,
} = {}) {
  validateGeneratedAt(generatedAt);
  if (!Array.isArray(definitions) || definitions.length < 1 || definitions.length > 16) {
    throw new Error('Exporter packaging requires between 1 and 16 release definitions.');
  }
  const acceptedSources = [];
  for (const definition of definitions) {
    const sourcePath = resolveExporterReleaseSourcePath(definition, workspaceRoot);
    const bytes = await readVerifiedExporterJar(sourcePath, `Exporter release ${definition.id}`);
    await requireAcceptance({
      definition,
      sourceBytes: bytes,
      acceptanceRoot,
      logger,
      testOnlyBypassAcceptanceReceipt,
    });
    acceptedSources.push({definition, bytes});
  }

  await requireRealExporterPublicRoot(publicRoot, {create: true});
  return withExporterReleaseManifestLock({
    publicRoot,
    operation: 'all configured releases',
    logger,
    action: async assertLockOwned => {
      const plans = [];
      for (const {definition, bytes} of acceptedSources) {
        await requireAcceptance({
          definition,
          sourceBytes: bytes,
          acceptanceRoot,
          logger,
          testOnlyBypassAcceptanceReceipt,
        });
        const targetPath = join(publicRoot, definition.filename);
        const release = releaseForBytes(definition, bytes);
        const existingBytes = await optionalVerifiedJar(
          targetPath,
          `Existing public JAR ${definition.id}`,
        );
        if (existingBytes !== null && !bytesMatchRelease(existingBytes, release)) {
          throw new Error(
            `Immutable public JAR ${definition.id} already exists with different bytes: ${targetPath}. ` +
              'Increment the release version and filename; same-URL replacement is forbidden.',
          );
        }
        plans.push({
          definition,
          bytes,
          targetPath,
          release,
          needsWrite: existingBytes === null,
        });
      }
      const releases = plans.map(plan => plan.release);
      const manifest = requireExporterReleaseManifest({
        format: EXPORTER_RELEASE_MANIFEST_FORMAT,
        generatedAt,
        releases,
      });
      const created = [];
      try {
        for (const plan of plans) {
          await assertLockOwned();
          if (plan.needsWrite) {
            await atomicWriteNew(plan.targetPath, plan.bytes);
            created.push(plan.targetPath);
          }
          logger.info(
            `[exporter-release] ${plan.needsWrite ? 'Packaged' : 'Verified immutable'} ` +
              `${plan.definition.id}: ${plan.bytes.length} bytes, sha256=${plan.release.sha256}.`,
          );
        }
        await assertLockOwned();
        await atomicWrite(
          join(publicRoot, 'manifest.json'),
          `${JSON.stringify(manifest, null, 2)}\n`,
        );
      } catch (error) {
        const rollbackErrors = [];
        for (const path of created.reverse()) {
          try {
            await unlink(path);
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError);
          }
        }
        if (rollbackErrors.length > 0) {
          throw new AggregateError(
            [error, ...rollbackErrors],
            'All-release packaging failed and could not remove every newly created immutable JAR.',
          );
        }
        throw error;
      }
      logger.info(
        `[exporter-release] Wrote ${releases.length} checksummed releases to ${publicRoot}.`,
      );
      return manifest;
    },
  });
}

/**
 * Update exactly one configured release in an already valid public catalog. The existing catalog
 * and selected public JAR are verified before mutation. Every unrelated release entry and file is
 * left untouched; there is deliberately no fallback to the all-release packager.
 */
export async function packageExporterRelease({
  releaseId,
  workspaceRoot = DEFAULT_WORKSPACE_ROOT,
  publicRoot = DEFAULT_PUBLIC_ROOT,
  acceptanceRoot = DEFAULT_EXPORTER_ACCEPTANCE_ROOT,
  definitions = EXPORTER_RELEASE_DEFINITIONS,
  generatedAt = new Date().toISOString(),
  logger = console,
  testOnlyBypassAcceptanceReceipt = false,
  testOnlyAfterManifestWrite = undefined,
} = {}) {
  validateGeneratedAt(generatedAt);
  if (!Array.isArray(definitions) || definitions.length < 1 || definitions.length > 16) {
    throw new Error('Exporter packaging requires between 1 and 16 release definitions.');
  }
  const definition = exporterReleaseDefinitionForId(definitions, releaseId);
  const sourcePath = resolveExporterReleaseSourcePath(definition, workspaceRoot);
  const sourceBytes = await readVerifiedExporterJar(sourcePath, `Exporter release ${releaseId}`);
  await requireAcceptance({
    definition,
    sourceBytes,
    acceptanceRoot,
    logger,
    testOnlyBypassAcceptanceReceipt,
  });
  await requireRealExporterPublicRoot(publicRoot);
  return withExporterReleaseManifestLock({
    publicRoot,
    operation: `targeted release ${releaseId}`,
    logger,
    action: async assertLockOwned => {
  await requireAcceptance({
    definition,
    sourceBytes,
    acceptanceRoot,
    logger,
    testOnlyBypassAcceptanceReceipt,
  });
  const manifestPath = join(publicRoot, 'manifest.json');
  const existingState = await readVerifiedManifest(manifestPath, 'Existing exporter release manifest');
  const existingIndex = existingState.manifest.releases.findIndex(release => release.id === releaseId);
  if (existingIndex === -1) {
    throw new Error(
      `Existing exporter release manifest has no ${JSON.stringify(releaseId)} entry; targeted packaging cannot invent catalog membership.`,
    );
  }
  const existingRelease = existingState.manifest.releases[existingIndex];
  const existingTargetPath = join(publicRoot, existingRelease.filename);
  const existingJarBytes = await readVerifiedExporterJar(
    existingTargetPath,
    `Existing public JAR ${releaseId}`,
  );
  if (!bytesMatchRelease(existingJarBytes, existingRelease)) {
    throw new Error(
      `Existing public JAR ${releaseId} does not match its manifest checksum and byte count; no targeted update was attempted.`,
    );
  }
  const updatedRelease = releaseForBytes(definition, sourceBytes);
  if (exactJsonEqual(updatedRelease, existingRelease)) {
    logger.info(
      `[exporter-release] ${releaseId} already matches its configured source; no public file or manifest timestamp was rewritten.`,
    );
    return existingState.manifest;
  }

  const filenameChanged = existingRelease.filename !== updatedRelease.filename;
  const versionChanged = existingRelease.version !== updatedRelease.version;
  if (filenameChanged !== versionChanged) {
    throw new Error(
      `Targeted ${releaseId} version and filename must change together to preserve immutable download URLs.`,
    );
  }
  if (!filenameChanged && !bytesMatchRelease(existingJarBytes, updatedRelease)) {
    throw new Error(
      `Immutable public JAR ${releaseId} would change bytes under ${existingRelease.filename}. ` +
        'Increment the configured release version and filename before packaging.',
    );
  }

  const targetPath = join(publicRoot, updatedRelease.filename);
  const targetBytes = filenameChanged
    ? await optionalVerifiedJar(targetPath, `Existing versioned public JAR ${releaseId}`)
    : existingJarBytes;
  if (targetBytes !== null && !bytesMatchRelease(targetBytes, updatedRelease)) {
    throw new Error(
      `Versioned target ${targetPath} already exists with different bytes; refusing immutable release replacement.`,
    );
  }

  const updatedDocument = {
    format: EXPORTER_RELEASE_MANIFEST_FORMAT,
    generatedAt,
    releases: existingState.manifest.releases.map((release, index) =>
      index === existingIndex ? updatedRelease : release),
  };
  const updatedManifest = requireExporterReleaseManifest(updatedDocument);
  for (let index = 0; index < existingState.manifest.releases.length; index += 1) {
    if (
      index !== existingIndex &&
      !exactJsonEqual(existingState.manifest.releases[index], updatedManifest.releases[index])
    ) {
      throw new Error(`Targeted packaging changed unrelated manifest entry at index ${index}.`);
    }
  }

  const jarNeedsWrite = targetBytes === null;
  let jarCreated = false;
  let manifestWritten = false;
  try {
    await assertLockOwned();
    if (jarNeedsWrite) {
      await atomicWriteNew(targetPath, sourceBytes);
      jarCreated = true;
      const publishedBytes = await readVerifiedExporterJar(
        targetPath,
        `Published public JAR ${releaseId}`,
      );
      if (!bytesMatchRelease(publishedBytes, updatedRelease)) {
        throw new Error(`Published public JAR ${releaseId} failed checksum verification.`);
      }
    }
    await assertLockOwned();
    await atomicWrite(manifestPath, `${JSON.stringify(updatedManifest, null, 2)}\n`);
    manifestWritten = true;
    if (typeof testOnlyAfterManifestWrite === 'function') {
      await testOnlyAfterManifestWrite({manifestPath, targetPath});
    }
    const committed = await readVerifiedManifest(manifestPath, 'Committed exporter release manifest');
    if (!exactJsonEqual(committed.manifest, updatedManifest)) {
      throw new Error('Committed exporter release manifest differs from the validated update.');
    }
  } catch (error) {
    logger.error(
      `[exporter-release] Targeted packaging failed for ${releaseId}; restoring the verified prior release state.`,
      error,
    );
    const rollbackErrors = [];
    if (manifestWritten) {
      try {
        await atomicWrite(manifestPath, existingState.bytes);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (jarCreated) {
      if (manifestWritten) {
        logger.error(
          `[exporter-release] Retaining ${targetPath} because a committed manifest referenced it before rollback. Its URL remains permanently immutable.`,
        );
      } else {
        try {
          const rollbackTarget = await readVerifiedExporterJar(
            targetPath,
            `Rollback candidate public JAR ${releaseId}`,
          );
          if (!bytesMatchRelease(rollbackTarget, updatedRelease)) {
            throw new Error(`Rollback refused changed release target ${targetPath}.`);
          }
          await unlink(targetPath);
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        `Targeted packaging and rollback both failed for ${releaseId}.`,
      );
    }
    throw error;
  }

  logger.info(
    `[exporter-release] Updated only ${releaseId}: ${sourceBytes.length} bytes, sha256=${updatedRelease.sha256}.`,
  );
  return updatedManifest;
    },
  });
}

function usage() {
  return [
    'Package every configured exporter release:',
    '  node scripts/package-exporter-releases.mjs --all',
    '',
    'Package exactly one existing release without touching unrelated JARs or manifest entries:',
    '  node scripts/package-exporter-releases.mjs --release <release-id>',
  ].join('\n');
}

export function parsePackageExporterArguments(argv) {
  if (argv.length === 0) {
    throw new Error(`Exporter packaging requires explicit --all or --release.\n${usage()}`);
  }
  if (argv.length === 1 && argv[0] === '--all') return {command: 'all'};
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) return {command: 'help'};
  if (argv.length === 2 && argv[0] === '--release') {
    if (!RELEASE_ID_PATTERN.test(argv[1])) throw new Error('--release requires one canonical release ID.');
    return {command: 'release', releaseId: argv[1]};
  }
  throw new Error(`Invalid exporter packaging arguments.\n${usage()}`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  console.error(
    '[exporter-release] On-site JAR packaging is disabled by distribution policy. ' +
      'Build artifacts remain in their version-specific build/libs directories for external hosting.',
  );
  process.exitCode = 1;
}
