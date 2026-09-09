import assert from 'node:assert/strict';
import {
  link,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {
  EXPORTER_RELEASE_DEFINITIONS,
  EXPORTER_RELEASE_MANIFEST_FORMAT,
  atomicWriteNew,
  packageExporterRelease,
  packageExporterReleases,
  parsePackageExporterArguments,
  withExporterReleaseManifestLock,
} from './package-exporter-releases.mjs';
import {
  buildExporterAcceptanceReceipt,
  exporterAcceptancePolicySha256,
  writeExporterAcceptanceReceipt,
} from './exporter-release-acceptance.mjs';

const quietLogger = Object.freeze({info() {}, warn() {}, error() {}});

test('NeoForge 1.21.1 release is isolated and uses the strict generic JEI profile', () => {
  const release = EXPORTER_RELEASE_DEFINITIONS.find(
    candidate => candidate.id === 'neoforge-jei-1.21.1',
  );
  assert.ok(release);
  assert.deepEqual(
    {
      minecraftVersion: release.minecraftVersion,
      recipeViewer: release.recipeViewer,
      loader: release.loader,
      version: release.version,
      source: release.source,
      filename: release.filename,
      qualityProfiles: release.qualityProfiles,
      artifactProvenance: release.artifactProvenance,
      acceptanceCorpora: release.acceptanceCorpora,
    },
    {
      minecraftVersion: '1.21.1',
      recipeViewer: 'JEI 19',
      loader: 'NeoForge 21.1',
      version: '1.0.0',
      source: 'recipe-export-mod-1.21.1/build/libs/jeiexport-1.0.0.jar',
      filename: 'recipe-tree-exporter-neoforge-1.21.1-1.0.0.jar',
      qualityProfiles: ['generic-jei-1.21.1'],
      artifactProvenance: null,
      acceptanceCorpora: {'generic-jei-1.21.1': null},
    },
  );
});

test('Multiblock Madness exporter releases remain isolated across independent versions', () => {
  const mm1 = EXPORTER_RELEASE_DEFINITIONS.find(
    candidate => candidate.id === 'forge-hei-1.12.2',
  );
  const mm2 = EXPORTER_RELEASE_DEFINITIONS.find(
    candidate => candidate.id === 'forge-rei-1.18.2',
  );
  assert.ok(mm1);
  assert.ok(mm2);
  assert.deepEqual(
    {
      id: mm1.id,
      minecraftVersion: mm1.minecraftVersion,
      version: mm1.version,
      source: mm1.source,
      filename: mm1.filename,
      qualityProfiles: mm1.qualityProfiles,
    },
    {
      id: 'forge-hei-1.12.2',
      minecraftVersion: '1.12.2',
      version: '1.2.0-beta.128',
      source: 'recipe-export-mod-1.12.2/build/libs/recipe-export-mod-1.12.2-1.2.0-beta.128.jar',
      filename: 'recipe-tree-exporter-forge-1.12.2-1.2.0-beta.128.jar',
      qualityProfiles: ['meatballcraft-1.12.2', 'multiblock-madness-1.12.2'],
    },
  );
  assert.deepEqual(
    {
      id: mm2.id,
      minecraftVersion: mm2.minecraftVersion,
      version: mm2.version,
      source: mm2.source,
      filename: mm2.filename,
      qualityProfiles: mm2.qualityProfiles,
    },
    {
      id: 'forge-rei-1.18.2',
      minecraftVersion: '1.18.2',
      version: '1.0.52',
      source: 'recipe-export-mod-1.18.2/build/libs/recipe-export-mod-1.18.2-1.0.52.jar',
      filename: 'recipe-tree-exporter-forge-1.18.2-1.0.52.jar',
      qualityProfiles: ['multiblock-madness-2-1.18.2'],
    },
  );
  assert.notEqual(mm1.id, mm2.id);
  assert.notEqual(mm1.source, mm2.source);
  assert.notEqual(mm1.filename, mm2.filename);
  assert.deepEqual(mm1.acceptanceCorpora['meatballcraft-1.12.2'], {
    items: 196920,
    recipes: 376179,
    categories: 680,
    mobs: 0,
    blockDrops: 0,
  });
  assert.deepEqual(mm1.acceptanceCorpora['multiblock-madness-1.12.2'], {
    items: 88262,
    recipes: 107814,
    categories: 378,
    mobs: 0,
    blockDrops: 0,
  });
  assert.deepEqual(mm2.acceptanceCorpora['multiblock-madness-2-1.18.2'], {
      items: 68551,
    recipes: 99908,
    categories: 333,
    mobs: 0,
    blockDrops: 0,
  });
});

test('GTNH release requires the exact runtime-bound exporter identity before acceptance', () => {
  const release = EXPORTER_RELEASE_DEFINITIONS.find(
    candidate => candidate.id === 'forge-nei-gtnh-1.7.10',
  );
  assert.ok(release);
  assert.equal(release.version, '1.0.154');
  assert.equal(
    release.source,
    'recipe-export-mod-1.7.10/build/libs/recipe-tree-gtnh-nei-exporter-1.0.154.jar',
  );
  assert.equal(release.filename, 'recipe-tree-exporter-gtnh-1.7.10-1.0.154.jar');
  assert.deepEqual(release.qualityProfiles, ['gtnh-1.7.10']);
  assert.deepEqual(release.artifactProvenance, {
    format: 'mrt-exporter-build-v1',
    exporterId: 'forge-nei-gtnh-1.7.10',
    minecraftVersion: '1.7.10',
  });
  assert.deepEqual(release.acceptanceCorpora['gtnh-1.7.10'], {
    items: 143882,
    recipes: 568820,
    categories: 287,
    mobs: 0,
    blockDrops: 0,
  });
});

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'mrt-exporter-release-test-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const publicRoot = join(root, 'public', 'exporters');
  await mkdir(join(root, 'build', 'libs'), {recursive: true});
  await writeFile(join(root, 'build', 'libs', 'exporter.jar'), Buffer.from([
    0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00,
  ]));
  return {root, publicRoot};
}

function definition(overrides = {}) {
  return {
    id: 'test-exporter',
    minecraftVersion: '1.20.1',
    recipeViewer: 'JEI 15',
    loader: 'Forge 47',
    version: '1.0.0',
    source: 'build/libs/exporter.jar',
    filename: 'recipe-tree-exporter-test.jar',
    qualityProfiles: ['generic-jei-1.20.1'],
    artifactProvenance: null,
    acceptanceCorpora: {'generic-jei-1.20.1': null},
    compatibility: 'Test compatibility',
    ...overrides,
  };
}

test('packages only the configured release JAR and writes an exact checksummed manifest', async t => {
  const {root, publicRoot} = await fixture(t);
  const manifest = await packageExporterReleases({
    workspaceRoot: root,
    publicRoot,
    definitions: [definition()],
    generatedAt: '2026-07-19T12:00:00.000Z',
    logger: quietLogger,
    testOnlyBypassAcceptanceReceipt: true,
  });
  assert.equal(manifest.format, EXPORTER_RELEASE_MANIFEST_FORMAT);
  assert.equal(manifest.releases[0].bytes, 8);
  assert.match(manifest.releases[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.releases[0].source, undefined);
  assert.deepEqual(
    JSON.parse(await readFile(join(publicRoot, 'manifest.json'), 'utf8')),
    manifest,
  );
  assert.deepEqual(
    await readFile(join(publicRoot, definition().filename)),
    await readFile(join(root, definition().source)),
  );
});

test('rejects development filenames and non-JAR content', async t => {
  const {root, publicRoot} = await fixture(t);
  await assert.rejects(
    packageExporterReleases({
      workspaceRoot: root,
      publicRoot,
      definitions: [definition({filename: 'exporter-dev.jar'})],
      logger: quietLogger,
      testOnlyBypassAcceptanceReceipt: true,
    }),
    /invalid .*filename/,
  );
  await writeFile(join(root, 'build', 'libs', 'exporter.jar'), 'not a jar');
  await assert.rejects(
    packageExporterReleases({
      workspaceRoot: root,
      publicRoot,
      definitions: [definition()],
      logger: quietLogger,
      testOnlyBypassAcceptanceReceipt: true,
    }),
    /ZIP\/JAR local-file signature/,
  );
});

test('rejects a symlinked build artifact without following it', async t => {
  if (process.platform === 'win32') {
    t.skip('Creating filesystem symlinks requires an elevated Windows test environment.');
    return;
  }
  const {root, publicRoot} = await fixture(t);
  const source = join(root, 'build', 'libs', 'exporter.jar');
  const target = join(root, 'build', 'libs', 'target.jar');
  await writeFile(target, Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  await rm(source);
  await symlink(target, source);
  await assert.rejects(
    packageExporterReleases({
      workspaceRoot: root,
      publicRoot,
      definitions: [definition()],
      logger: quietLogger,
      testOnlyBypassAcceptanceReceipt: true,
    }),
    /plain, non-hard-linked regular file/,
  );
});

test('targeted packaging creates one immutable version and preserves every unrelated entry and JAR', async t => {
  const {root, publicRoot} = await fixture(t);
  const selectedV100 = definition();
  const unrelated = definition({
    id: 'unrelated-exporter',
    minecraftVersion: '1.18.2',
    recipeViewer: 'REI 8',
    loader: 'Forge 40',
    source: 'build/libs/unrelated.jar',
    filename: 'recipe-tree-exporter-unrelated-1.0.0.jar',
    qualityProfiles: ['multiblock-madness-2-1.18.2'],
  });
  await writeFile(
    join(root, unrelated.source),
    Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x18, 0x00, 0x00, 0x00]),
  );
  await packageExporterReleases({
    workspaceRoot: root,
    publicRoot,
    definitions: [selectedV100, unrelated],
    generatedAt: '2026-07-19T12:00:00.000Z',
    logger: quietLogger,
    testOnlyBypassAcceptanceReceipt: true,
  });

  const priorManifest = JSON.parse(await readFile(join(publicRoot, 'manifest.json'), 'utf8'));
  const oldSelectedBytes = await readFile(join(publicRoot, selectedV100.filename));
  const unrelatedPath = join(publicRoot, unrelated.filename);
  const unrelatedBytes = await readFile(unrelatedPath);
  const unrelatedStat = await lstat(unrelatedPath, {bigint: true});
  await rm(join(root, unrelated.source));

  const selectedV101 = definition({
    version: '1.0.1',
    filename: 'recipe-tree-exporter-test-1.0.1.jar',
  });
  const selectedV101Bytes = Buffer.from([
    0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x01,
  ]);
  await writeFile(join(root, selectedV101.source), selectedV101Bytes);
  const updated = await packageExporterRelease({
    releaseId: selectedV101.id,
    workspaceRoot: root,
    publicRoot,
    definitions: [selectedV101, unrelated],
    generatedAt: '2026-07-19T13:00:00.000Z',
    logger: quietLogger,
    testOnlyBypassAcceptanceReceipt: true,
  });

  assert.equal(updated.generatedAt, '2026-07-19T13:00:00.000Z');
  assert.equal(updated.releases[0].version, '1.0.1');
  assert.equal(updated.releases[0].filename, selectedV101.filename);
  assert.deepEqual(updated.releases[1], priorManifest.releases[1]);
  assert.deepEqual(await readFile(join(publicRoot, selectedV100.filename)), oldSelectedBytes);
  assert.deepEqual(await readFile(join(publicRoot, selectedV101.filename)), selectedV101Bytes);
  assert.deepEqual(await readFile(unrelatedPath), unrelatedBytes);
  const unrelatedAfter = await lstat(unrelatedPath, {bigint: true});
  assert.equal(unrelatedAfter.ino, unrelatedStat.ino);
  assert.equal(unrelatedAfter.mtimeNs, unrelatedStat.mtimeNs);

  const manifestPath = join(publicRoot, 'manifest.json');
  const selectedPath = join(publicRoot, selectedV101.filename);
  const manifestBeforeNoop = await lstat(manifestPath, {bigint: true});
  const selectedBeforeNoop = await lstat(selectedPath, {bigint: true});
  const noOp = await packageExporterRelease({
    releaseId: selectedV101.id,
    workspaceRoot: root,
    publicRoot,
    definitions: [selectedV101, unrelated],
    generatedAt: '2026-07-19T14:00:00.000Z',
    logger: quietLogger,
    testOnlyBypassAcceptanceReceipt: true,
  });
  assert.equal(noOp.generatedAt, '2026-07-19T13:00:00.000Z');
  const manifestAfterNoop = await lstat(manifestPath, {bigint: true});
  const selectedAfterNoop = await lstat(selectedPath, {bigint: true});
  assert.equal(manifestAfterNoop.ino, manifestBeforeNoop.ino);
  assert.equal(manifestAfterNoop.mtimeNs, manifestBeforeNoop.mtimeNs);
  assert.equal(manifestAfterNoop.size, manifestBeforeNoop.size);
  assert.equal(selectedAfterNoop.ino, selectedBeforeNoop.ino);
  assert.equal(selectedAfterNoop.mtimeNs, selectedBeforeNoop.mtimeNs);
  assert.equal(selectedAfterNoop.size, selectedBeforeNoop.size);
});

test('packaging refuses to replace bytes under an existing release version and filename', async t => {
  const {root, publicRoot} = await fixture(t);
  const release = definition();
  await packageExporterReleases({
    workspaceRoot: root,
    publicRoot,
    definitions: [release],
    generatedAt: '2026-07-19T12:00:00.000Z',
    logger: quietLogger,
    testOnlyBypassAcceptanceReceipt: true,
  });
  const manifestBefore = await readFile(join(publicRoot, 'manifest.json'));
  const publicJarBefore = await readFile(join(publicRoot, release.filename));
  await writeFile(
    join(root, release.source),
    Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x99, 0x00, 0x00, 0x00]),
  );

  await assert.rejects(
    packageExporterRelease({
      releaseId: release.id,
      workspaceRoot: root,
      publicRoot,
      definitions: [release],
      generatedAt: '2026-07-19T13:00:00.000Z',
      logger: quietLogger,
      testOnlyBypassAcceptanceReceipt: true,
    }),
    /Increment the configured release version and filename/,
  );
  await assert.rejects(
    packageExporterReleases({
      workspaceRoot: root,
      publicRoot,
      definitions: [release],
      generatedAt: '2026-07-19T13:00:00.000Z',
      logger: quietLogger,
      testOnlyBypassAcceptanceReceipt: true,
    }),
    /same-URL replacement is forbidden/,
  );
  assert.deepEqual(await readFile(join(publicRoot, 'manifest.json')), manifestBefore);
  assert.deepEqual(await readFile(join(publicRoot, release.filename)), publicJarBefore);
});

test('post-commit rollback restores the catalog but permanently retains the external artifact', async t => {
  const {root, publicRoot} = await fixture(t);
  const releaseV100 = definition();
  await packageExporterReleases({
    workspaceRoot: root,
    publicRoot,
    definitions: [releaseV100],
    generatedAt: '2026-07-19T12:00:00.000Z',
    logger: quietLogger,
    testOnlyBypassAcceptanceReceipt: true,
  });
  const manifestBefore = await readFile(join(publicRoot, 'manifest.json'));
  const releaseV101 = definition({
    version: '1.0.1',
    filename: 'recipe-tree-exporter-test-1.0.1.jar',
  });
  const acceptedV101Bytes = Buffer.from([
    0x50, 0x4b, 0x03, 0x04, 0x19, 0x00, 0x00, 0x00,
  ]);
  await writeFile(join(root, releaseV101.source), acceptedV101Bytes);
  await assert.rejects(
    packageExporterRelease({
      releaseId: releaseV101.id,
      workspaceRoot: root,
      publicRoot,
      definitions: [releaseV101],
      generatedAt: '2026-07-19T13:00:00.000Z',
      logger: quietLogger,
      testOnlyBypassAcceptanceReceipt: true,
      async testOnlyAfterManifestWrite({manifestPath}) {
        await writeFile(manifestPath, '{invalid json\n');
      },
    }),
    /not valid JSON/,
  );
  assert.deepEqual(await readFile(join(publicRoot, 'manifest.json')), manifestBefore);
  assert.deepEqual(await readFile(join(publicRoot, releaseV101.filename)), acceptedV101Bytes);

  await writeFile(
    join(root, releaseV101.source),
    Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x20, 0x00, 0x00, 0x00]),
  );
  await assert.rejects(
    packageExporterRelease({
      releaseId: releaseV101.id,
      workspaceRoot: root,
      publicRoot,
      definitions: [releaseV101],
      generatedAt: '2026-07-19T14:00:00.000Z',
      logger: quietLogger,
      testOnlyBypassAcceptanceReceipt: true,
    }),
    /already exists with different bytes/,
  );
});

test('parses explicit all and single-release commands without an implicit targeted fallback', () => {
  assert.throws(
    () => parsePackageExporterArguments([]),
    /requires explicit --all or --release/,
  );
  assert.deepEqual(parsePackageExporterArguments(['--all']), {command: 'all'});
  assert.deepEqual(parsePackageExporterArguments(['--help']), {command: 'help'});
  assert.deepEqual(
    parsePackageExporterArguments(['--release', 'forge-hei-1.12.2']),
    {command: 'release', releaseId: 'forge-hei-1.12.2'},
  );
  assert.throws(() => parsePackageExporterArguments(['--release']), /Invalid exporter packaging/);
  assert.throws(
    () => parsePackageExporterArguments(['--release', '../escape']),
    /canonical release ID/,
  );
  assert.throws(
    () => parsePackageExporterArguments(['--all', '--release', 'forge-hei-1.12.2']),
    /Invalid exporter packaging/,
  );
});

test('requires a SHA-bound acceptance receipt before creating a public release directory', async t => {
  const {root, publicRoot} = await fixture(t);
  await assert.rejects(
    packageExporterReleases({
      workspaceRoot: root,
      publicRoot,
      acceptanceRoot: join(root, 'missing-acceptance'),
      definitions: [definition()],
      generatedAt: '2026-07-19T12:00:00.000Z',
      logger: quietLogger,
    }),
    /acceptance receipt is missing/,
  );
  await assert.rejects(lstat(publicRoot), error => error?.code === 'ENOENT');
});

test('packages an artifact only when its exact source and allowed profile match the receipt', async t => {
  const {root, publicRoot} = await fixture(t);
  const release = definition();
  const sourceBytes = await readFile(join(root, release.source));
  const exportManifest = {
    generatedAt: '2026-07-19T11:00:00.000Z',
    minecraft: release.minecraftVersion,
    counts: {items: 1, recipes: 1, categories: 1, mobs: 0, blockDrops: 0},
  };
  const exportManifestBytes = Buffer.from(`${JSON.stringify(exportManifest)}\n`);
  const acceptanceRoot = join(root, 'acceptance');
  const receipt = buildExporterAcceptanceReceipt({
    definition: release,
    sourceBytes,
    qualityProfile: release.qualityProfiles[0],
    exportManifestBytes,
    exportManifest,
    pack: {name: 'Test Pack', version: '1.0.0', identitySource: 'explicit-request'},
    exporterBuild: null,
    exportTree: {
      format: 'mrt-export-tree-v1',
      algorithm: 'sha256',
      sha256: 'a'.repeat(64),
      files: 1,
      bytes: exportManifestBytes.length,
    },
    validationPolicySha256: await exporterAcceptancePolicySha256(
      release,
      release.qualityProfiles[0],
    ),
    acceptedAt: '2026-07-19T12:00:00.000Z',
  });
  await mkdir(publicRoot, {recursive: true});
  await writeExporterAcceptanceReceipt({
    receipt,
    acceptanceRoot,
    publicRoot,
    logger: quietLogger,
  });
  const manifest = await packageExporterReleases({
    workspaceRoot: root,
    publicRoot,
    acceptanceRoot,
    definitions: [release],
    generatedAt: '2026-07-19T13:00:00.000Z',
    logger: quietLogger,
  });
  assert.equal(manifest.releases[0].sha256, receipt.release.sha256);
});

test('multi-profile packaging fails explicitly until every advertised profile has its own receipt', async t => {
  const {root, publicRoot} = await fixture(t);
  const release = definition({
    qualityProfiles: ['generic-jei-1.20.1', 'multiblock-madness-2-1.18.2'],
    acceptanceCorpora: {
      'generic-jei-1.20.1': null,
      'multiblock-madness-2-1.18.2': null,
    },
  });
  const sourceBytes = await readFile(join(root, release.source));
  const exportManifest = {
    generatedAt: '2026-07-19T11:00:00.000Z',
    minecraft: release.minecraftVersion,
    counts: {items: 1, recipes: 1, categories: 1, mobs: 0, blockDrops: 0},
  };
  const exportManifestBytes = Buffer.from(`${JSON.stringify(exportManifest)}\n`);
  const acceptanceRoot = join(root, 'acceptance-multi');
  const qualityProfile = release.qualityProfiles[0];
  const receipt = buildExporterAcceptanceReceipt({
    definition: release,
    sourceBytes,
    qualityProfile,
    exportManifestBytes,
    exportManifest,
    pack: {name: 'Test Pack', version: '1.0.0', identitySource: 'explicit-request'},
    exporterBuild: null,
    exportTree: {
      format: 'mrt-export-tree-v1',
      algorithm: 'sha256',
      sha256: 'b'.repeat(64),
      files: 1,
      bytes: exportManifestBytes.length,
    },
    validationPolicySha256: await exporterAcceptancePolicySha256(
      release,
      qualityProfile,
    ),
    acceptedAt: '2026-07-19T12:00:00.000Z',
  });
  await writeExporterAcceptanceReceipt({
    receipt,
    acceptanceRoot,
    logger: quietLogger,
    testOnlyBypassManifestLock: true,
  });

  await assert.rejects(
    packageExporterReleases({
      workspaceRoot: root,
      publicRoot,
      acceptanceRoot,
      definitions: [release],
      generatedAt: '2026-07-19T13:00:00.000Z',
      logger: quietLogger,
    }),
    /not fully accepted; profile multiblock-madness-2-1\.18\.2 failed: Exporter acceptance receipt is missing/,
  );
  await assert.rejects(lstat(publicRoot), error => error?.code === 'ENOENT');
});

test('exclusive manifest lock rejects concurrent and stale-lock guesses without auto-removal', async t => {
  const {publicRoot} = await fixture(t);
  await mkdir(publicRoot, {recursive: true});
  let actionStarted;
  const started = new Promise(resolve => {
    actionStarted = resolve;
  });
  let releaseAction;
  const held = new Promise(resolve => {
    releaseAction = resolve;
  });
  const first = withExporterReleaseManifestLock({
    publicRoot,
    operation: 'held test operation',
    logger: quietLogger,
    action: async assertOwned => {
      await assertOwned();
      actionStarted();
      await held;
      await assertOwned();
      return 'complete';
    },
  });
  await started;
  await assert.rejects(
    withExporterReleaseManifestLock({
      publicRoot,
      operation: 'conflicting test operation',
      logger: quietLogger,
      action: async () => {},
    }),
    /never auto-removed.*remove it manually/,
  );
  releaseAction();
  assert.equal(await first, 'complete');

  const staleLock = join(publicRoot, '.exporter-release-manifest.lock');
  await writeFile(staleLock, '{"stale":true}\n');
  await assert.rejects(
    withExporterReleaseManifestLock({
      publicRoot,
      operation: 'stale test operation',
      logger: quietLogger,
      action: async () => {},
    }),
    /never auto-removed.*remove it manually/,
  );
  assert.equal((await lstat(staleLock)).isFile(), true);
});

test('atomic no-replace JAR creation removes both links when temporary unlink fails', async t => {
  const {root} = await fixture(t);
  const target = join(root, 'atomic-release.jar');
  let failedTemporaryUnlink = false;
  const operations = {
    writeFile,
    link,
    async unlink(path) {
      if (path !== target && !failedTemporaryUnlink) {
        failedTemporaryUnlink = true;
        const error = new Error('simulated temporary unlink failure');
        error.code = 'EIO';
        throw error;
      }
      return unlink(path);
    },
  };
  await assert.rejects(
    atomicWriteNew(target, Buffer.from([0x50, 0x4b, 0x03, 0x04]), operations),
    /simulated temporary unlink failure/,
  );
  await assert.rejects(lstat(target), error => error?.code === 'ENOENT');
  assert.deepEqual(
    (await readdir(root)).filter(name => name.includes('atomic-release.jar') && name.endsWith('.tmp')),
    [],
  );

  const partialTarget = join(root, 'partial-write-release.jar');
  await assert.rejects(
    atomicWriteNew(partialTarget, Buffer.from([0x50, 0x4b, 0x03, 0x04]), {
      async writeFile(path, bytes, options) {
        await writeFile(path, bytes, options);
        throw new Error('simulated write failure after temporary creation');
      },
      link,
      unlink,
    }),
    /simulated write failure after temporary creation/,
  );
  await assert.rejects(lstat(partialTarget), error => error?.code === 'ENOENT');
  assert.deepEqual(
    (await readdir(root)).filter(
      name => name.includes('partial-write-release.jar') && name.endsWith('.tmp'),
    ),
    [],
  );
});

test('all-release packaging rejects a symlinked publicRoot before writing', async t => {
  if (process.platform === 'win32') {
    t.skip('Creating filesystem symlinks requires an elevated Windows test environment.');
    return;
  }
  const {root, publicRoot} = await fixture(t);
  const realPublicRoot = join(root, 'real-public-root');
  await mkdir(realPublicRoot);
  await mkdir(join(root, 'public'), {recursive: true});
  await symlink(realPublicRoot, publicRoot, 'dir');
  await assert.rejects(
    packageExporterReleases({
      workspaceRoot: root,
      publicRoot,
      definitions: [definition()],
      generatedAt: '2026-07-19T12:00:00.000Z',
      logger: quietLogger,
      testOnlyBypassAcceptanceReceipt: true,
    }),
    /publicRoot must be a real directory/,
  );
  assert.deepEqual(await readdir(realPublicRoot), []);
});
