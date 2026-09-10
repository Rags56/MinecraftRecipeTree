import {Modal} from '../ui/nativeUiScale';
import React, {useState} from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type {LoadedDatasetAttribution} from '../data/datasetAttribution';
import {theme} from '../theme';

function openAttributionLink(url: string, profile: string, label: string) {
  void Linking.openURL(url).catch(error => {
    console.error(`Could not open the ${profile} dataset ${label} link.`, {url, error});
  });
}

export function DatasetDisclaimer({
  attribution,
  variant = 'default',
}: {
  attribution: LoadedDatasetAttribution;
  variant?: 'default' | 'menu';
}) {
  const [visible, setVisible] = useState(false);
  const close = () => setVisible(false);

  return (
    <>
      <TouchableOpacity
        style={[styles.button, variant === 'menu' && styles.menuButton]}
        onPress={() => setVisible(true)}
        accessibilityRole="button"
        accessibilityLabel="Open GT New Horizons disclaimer"
        accessibilityHint="Shows dataset attribution, modification, license, artwork, and affiliation notices"
        focusable>
        <Text style={[styles.buttonText, variant === 'menu' && styles.menuButtonText]}>
          ⓘ GTNH disclaimer
        </Text>
      </TouchableOpacity>

      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={close}
        accessibilityViewIsModal>
        <Pressable style={styles.backdrop} onPress={close} accessible={false}>
          <Pressable style={styles.card} onPress={() => {}} accessible={false}>
            <View style={styles.header}>
              <View style={styles.headerCopy}>
                <Text style={styles.title} accessibilityRole="header">
                  GT New Horizons disclaimer
                </Text>
                <Text style={styles.subtitle}>
                  Dataset attribution, modification, license, and affiliation notice
                </Text>
              </View>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={close}
                accessibilityRole="button"
                accessibilityLabel="Close GT New Horizons disclaimer"
                focusable>
                <Text style={styles.closeText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
              <Text style={[styles.heading, styles.firstHeading]}>Recipe dataset</Text>
              <Text style={styles.body}>
                {attribution.packName} {attribution.packVersion} recipe data
                (profile {attribution.profile}; visuals {attribution.visualMode}) by the{' '}
                <Text
                  style={styles.link}
                  accessibilityRole="link"
                  onPress={() =>
                    openAttributionLink(
                      attribution.attribution.sourceUrl,
                      attribution.profile,
                      'source',
                    )
                  }>
                  GT New Horizons contributors
                </Text>
                .
              </Text>

              <Text style={styles.heading}>Modification notice</Text>
              <Text style={styles.body}>
                Recipe Tree normalized, deduplicated, indexed, and converted the source records
                into a web database. Runtime-rendered icons and recipe layouts were captured from
                the operator&apos;s installed pack by an exporter that does not bundle source
                textures.
              </Text>

              <Text style={styles.heading}>License and third-party artwork</Text>
              <Text style={styles.body}>
                The adapted GTNH-derived data is licensed under{' '}
                <Text
                  style={styles.link}
                  accessibilityRole="link"
                  onPress={() =>
                    openAttributionLink(
                      attribution.attribution.licenseUrl,
                      attribution.profile,
                      'license',
                    )
                  }>
                  {attribution.attribution.licenseIdentifier}
                </Text>{' '}
                and provided noncommercially as-is, without warranty. Third-party artwork remains
                subject to its original terms.
              </Text>

              <Text style={styles.heading}>Affiliation</Text>
              <Text style={styles.body}>
                Recipe Tree is not affiliated with or endorsed by GT New Horizons.
              </Text>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: 'flex-start',
    minHeight: 28,
    marginTop: 5,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 7,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.panelAlt,
  },
  buttonText: {color: theme.accent, fontSize: 10, fontWeight: '700'},
  menuButton: {
    width: '100%',
    minHeight: 44,
    marginTop: 0,
    paddingHorizontal: 12,
    alignItems: 'flex-start',
    justifyContent: 'center',
    borderColor: theme.borderLight,
  },
  menuButtonText: {color: theme.text, fontSize: 12},
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.76)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
  },
  card: {
    width: '100%',
    maxWidth: 640,
    maxHeight: '82%',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.panel,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 18,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  headerCopy: {flex: 1},
  title: {color: theme.text, fontSize: 19, fontWeight: '800'},
  subtitle: {color: theme.textDim, fontSize: 11, lineHeight: 16, marginTop: 4},
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.panelAlt,
  },
  closeText: {color: theme.textDim, fontSize: 16},
  scroll: {minHeight: 0},
  content: {padding: 18, paddingBottom: 22},
  heading: {
    color: theme.text,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
    marginTop: 14,
    marginBottom: 4,
  },
  firstHeading: {marginTop: 0},
  body: {color: theme.textDim, fontSize: 11, lineHeight: 17},
  link: {color: theme.accent, textDecorationLine: 'underline'},
});
