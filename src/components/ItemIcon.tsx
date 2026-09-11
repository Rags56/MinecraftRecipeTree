import React, {useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  StyleSheet,
  Text,
  View,
  type ImageErrorEvent,
} from 'react-native';
import {useData} from '../data/DataContext';
import {
  hasItemIconUriFailed,
  type ItemIconLoadFailure,
} from '../data/itemIconDiagnostics';
import {
  PROJECTE_EMC_KEY,
  projecteEmcIconItemKey,
} from '../data/projecteEmc';
import {theme} from '../theme';
import {CatalogItem} from '../types';
import {
  ITEM_ICON_LOAD_TIMEOUT_MS,
  ITEM_ICON_SPINNER_DELAY_MS,
  itemIconRetryDelayMs,
  type ItemIconFailureReason,
  itemIconSpinnerScale,
  shouldRetryItemIconLoad,
} from './itemIconLoading';
import {
  LOGICAL_ITEM_ICON_GRID_SIZE,
  isPixelGridAlignedItemIconSize,
} from './itemIconSizing';

/** Crisp nearest-neighbor scaling for minecraft pixel art (web only; ignored elsewhere). */
export const pixelated =
  Platform.OS === 'web' ? ({imageRendering: 'pixelated'} as unknown as object) : null;

/** Icon fallback labels are UI chrome and should not become a browser text selection. */
const noSelect = Platform.OS === 'web' ? ({userSelect: 'none'} as unknown as object) : null;

const FALLBACK_COLORS = ['#7d5ba6', '#5b8aa6', '#5ba67d', '#a6915b', '#a65b5b', '#5b5fa6', '#86a65b'];
const reportedMissingEmcIcons = new Set<string>();

function colorFor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return FALLBACK_COLORS[Math.abs(h) % FALLBACK_COLORS.length];
}

interface ItemIconFallbackProps {
  colorKey: string;
  label: string;
  size: number;
}

function ItemIconFallback({colorKey, label, size}: ItemIconFallbackProps) {
  const visibleLabel = label.trim() || '?';
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${visibleLabel} icon unavailable`}
      style={[
        styles.fallback,
        {width: size, height: size, backgroundColor: colorFor(colorKey)},
      ]}>
      <Text style={[styles.fallbackText, {fontSize: Math.max(10, size * 0.45)}, noSelect]}>
        {visibleLabel.charAt(0).toUpperCase() || '?'}
      </Text>
    </View>
  );
}

interface UriItemIconProps extends ItemIconFallbackProps {
  uri: string;
  itemKey?: string;
  reportFailure(failure: ItemIconLoadFailure): void;
}

/** The parent keys this component by URI, so any changed asset URI starts a fresh load attempt. */
function UriItemIcon({
  uri,
  itemKey,
  colorKey,
  label,
  size,
  reportFailure,
}: UriItemIconProps) {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  // Remounts the Image with the same URI. The URI is content-addressed, so a cache-busting query
  // is not an option: the service worker matches packed-image coordinates on an exact search
  // string and would stop recognizing the request.
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  const reportedFailure = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failRef = useRef<
    ((detail: unknown, reason?: ItemIconFailureReason) => void) | null
  >(null);
  useEffect(
    () => () => {
      if (retryTimer.current !== null) clearTimeout(retryTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (loaded) return undefined;
    const spinnerTimer = setTimeout(() => setSlow(true), ITEM_ICON_SPINNER_DELAY_MS);
    // A hung request never reports anything at all, so nothing but a timer can end this attempt.
    const timeoutTimer = setTimeout(
      () => failRef.current?.('The image load timed out without a response.', 'timeout'),
      ITEM_ICON_LOAD_TIMEOUT_MS,
    );
    return () => {
      clearTimeout(spinnerTimer);
      clearTimeout(timeoutTimer);
    };
  }, [attempt, loaded]);
  const failAttempt = (detail: unknown, reason: ItemIconFailureReason = 'error') => {
    const attemptsMade = attempt + 1;
    if (shouldRetryItemIconLoad(attemptsMade, reason)) {
      retryTimer.current = setTimeout(() => {
        retryTimer.current = null;
        setAttempt(attemptsMade);
      }, itemIconRetryDelayMs(attemptsMade));
      return;
    }
    // Only a load that exhausted its retries is a real failure worth a diagnostic.
    if (!reportedFailure.current) {
      reportedFailure.current = true;
      reportFailure({uri, itemKey, label, detail});
    }
    setFailedUri(uri);
  };
  failRef.current = failAttempt;
  if (hasItemIconUriFailed(failedUri, uri)) {
    return <ItemIconFallback colorKey={colorKey} label={label} size={size} />;
  }
  const onError = (event: ImageErrorEvent) => failAttempt(event.nativeEvent.error);
  return (
    <View style={{width: size, height: size}}>
      <Image
        key={attempt}
        source={{uri}}
        style={[{width: size, height: size}, pixelated as object]}
        resizeMode="contain"
        onLoad={() => setLoaded(true)}
        onError={onError}
      />
      {!loaded && (
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={`${label} icon loading`}
          style={[styles.loading, {width: size, height: size}]}>
          {slow && (
            <ActivityIndicator
              size="small"
              color={theme.textDim}
              style={{transform: [{scale: itemIconSpinnerScale(size)}]}}
            />
          )}
        </View>
      )}
    </View>
  );
}

export function ItemIcon({item, itemKey, size}: {item?: CatalogItem; itemKey?: string; size: number}) {
  if (Platform.OS === 'web' && !isPixelGridAlignedItemIconSize(size)) {
    const error = new Error(
      `ItemIcon size ${size}px is not aligned to the logical ` +
        `${LOGICAL_ITEM_ICON_GRID_SIZE}px pixel grid.`,
    );
    console.error(error.message);
    throw error;
  }
  const data = useData();
  const requestedKey = item?.k ?? itemKey;
  const iconItemKey = requestedKey ? projecteEmcIconItemKey(requestedKey) : undefined;
  const resolved =
    requestedKey === PROJECTE_EMC_KEY
      ? iconItemKey
        ? data.itemsByKey.get(iconItemKey)
        : undefined
      : item ?? (iconItemKey ? data.itemsByKey.get(iconItemKey) : undefined);
  if (requestedKey === PROJECTE_EMC_KEY && !resolved?.icon) {
    const diagnosticKey = `${data.datasetIdentity}\u0000${iconItemKey ?? 'missing-key'}`;
    if (!reportedMissingEmcIcons.has(diagnosticKey)) {
      reportedMissingEmcIcons.add(diagnosticKey);
      console.error('The ProjectE Transmutation Table icon is unavailable for EMC nodes.', {
        datasetIdentity: data.datasetIdentity,
        itemKey: iconItemKey,
      });
    }
  }
  const uri = data.imageUrl(resolved?.icon);
  const label = (resolved?.n ?? iconItemKey ?? '?').trim() || '?';
  const colorKey = resolved?.k ?? iconItemKey ?? '?';
  if (uri) {
    return (
      <UriItemIcon
        key={uri}
        uri={uri}
        itemKey={resolved?.k ?? itemKey}
        colorKey={colorKey}
        label={label}
        size={size}
        reportFailure={data.reportItemIconFailure}
      />
    );
  }
  return <ItemIconFallback colorKey={colorKey} label={label} size={size} />;
}

const styles = StyleSheet.create({
  /** Sits over the still-blank Image so a pending icon reads as loading rather than as missing. */
  loading: {
    position: 'absolute',
    top: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    backgroundColor: theme.panelAlt,
    opacity: 0.55,
  },
  fallback: {
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.9,
  },
  fallbackText: {
    color: theme.text,
    fontWeight: '700',
  },
});
