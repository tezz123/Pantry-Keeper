import { Feather, Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { File } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useColors } from '@/hooks/useColors';
import {
  PantryItem,
  PantryProvider,
  PantrySettings,
  usePantry,
} from '@/state/PantryContext';

type CaptureMode = 'product' | 'expiry';
type AddStep = 'product' | 'expiry' | 'details';

type Draft = {
  name: string;
  shelf: string;
  expiryDate: string;
  productPhotoUri?: string;
  expiryPhotoUri?: string;
  barcode?: string;
};

type LabelKind = 'product' | 'expiry';
type LabelReadResult = {
  name?: string;
  expiryDate?: string;
  confidence?: number;
};

function parseLabelResult(content: string): LabelReadResult {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1] ?? content.match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) throw new Error('The AI returned no structured result.');
  const parsed = JSON.parse(candidate) as Record<string, unknown>;
  return {
    name: typeof parsed.name === 'string' ? parsed.name.trim() : '',
    expiryDate: typeof parsed.expiryDate === 'string' ? parsed.expiryDate.trim() : '',
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
  };
}

function labelPrompt(kind: LabelKind) {
  return kind === 'product'
    ? 'Read the main food product name from this pantry label. Ignore slogans, nutrition facts, and marketing copy.'
    : 'Read the best-before or expiry date from this pantry label. Convert it to YYYY-MM-DD. If only month and year are visible, use the last day of that month. Do not invent a date.';
}

async function readLabelPhoto(
  uri: string,
  kind: LabelKind,
  settings: PantrySettings,
  openRouterApiKey: string,
): Promise<LabelReadResult> {
  const file = new File(uri);
  const imageData = `data:image/jpeg;base64,${await file.base64()}`;
  const prompt = `${labelPrompt(kind)} Return only valid JSON with the keys "name", "expiryDate", and "confidence". Use an empty string when a field cannot be read.`;

  if (settings.aiProvider === 'local') {
    const configuredUrl = settings.localBaseUrl.trim().replace(/\/+$/, '');
    if (!configuredUrl) throw new Error('Add a local AI URL in Settings first.');
    const endpoint = configuredUrl.endsWith('/chat/completions')
      ? configuredUrl
      : `${configuredUrl}/chat/completions`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(settings.localApiKey.trim()
          ? { Authorization: `Bearer ${settings.localApiKey.trim()}` }
          : {}),
      },
      body: JSON.stringify({
        model: settings.localModel.trim(),
        max_tokens: 8192,
        messages: [
          {
            role: 'system',
            content:
              'You read food labels. Return only valid JSON with name, expiryDate, and confidence.',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageData } },
            ],
          },
        ],
      }),
    });
    if (!response.ok) throw new Error('The local AI endpoint returned an error.');
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('The local AI returned no text.');
    return parseLabelResult(content);
  }

  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) throw new Error('The hosted AI endpoint is not configured.');
  const response = await fetch(`https://${domain}/api/ai/analyze-label`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind,
      model: settings.openRouterModel.trim(),
      openRouterApiKey: openRouterApiKey.trim() || undefined,
      imageData,
    }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? 'OpenRouter could not read this label.');
  }
  return (await response.json()) as LabelReadResult;
}

function daysUntil(dateString: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(`${dateString}T00:00:00`);
  return Math.ceil((expiry.getTime() - today.getTime()) / 86400000);
}

function prettyDate(dateString: string) {
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function itemTone(item: PantryItem, colors: ReturnType<typeof useColors>) {
  const days = daysUntil(item.expiryDate);
  if (days < 0) return { color: colors.terracotta, label: 'Past expiry' };
  if (days <= 30) return { color: colors.amber, label: `${days} days left` };
  return { color: colors.green, label: `${days} days left` };
}

function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    items,
    settings,
    isHydrated,
    removeItem,
    requestNotificationPermission,
  } = usePantry();
  const [showAdd, setShowAdd] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [itemToMove, setItemToMove] = useState<PantryItem | null>(null);
  const [filterShelf, setFilterShelf] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const filteredItems = useMemo(
    () =>
      [...items]
        .filter((item) => !filterShelf || item.shelf === filterShelf)
        .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate)),
    [items, filterShelf],
  );
  const expiringSoon = items.filter((item) => {
    const days = daysUntil(item.expiryDate);
    return days >= 0 && days <= settings.reminderDays;
  });
  const expired = items.filter((item) => daysUntil(item.expiryDate) < 0);

  async function confirmRemove(item: PantryItem) {
    Alert.alert('Remove item?', `${item.name} will be removed from your pantry.`, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setRemovingId(item.id);
          await removeItem(item.id);
          setRemovingId(null);
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        },
      },
    ]);
  }

  async function enableNotifications() {
    const granted = await requestNotificationPermission();
    if (!granted) {
      Alert.alert(
        'Notifications are off',
        'You can still track expiry dates in the app. Enable notifications in Android Settings when you are ready.',
      );
    } else {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }

  if (!isHydrated) {
    return (
      <View style={[styles.loading, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 100 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <View>
            <Text style={[styles.eyebrow, { color: colors.green }]}>PANTRY KEEPER</Text>
            <Text style={[styles.heading, { color: colors.forest }]}>Your stores,{"\n"}sorted.</Text>
          </View>
          <Pressable
            accessibilityLabel="Open settings"
            testID="settings-button"
            onPress={() => setShowSettings(true)}
            style={({ pressed }) => [
              styles.iconButton,
              { backgroundColor: colors.sage },
              pressed && styles.pressed,
            ]}
          >
            <Feather name="sliders" size={19} color={colors.forest} />
          </Pressable>
        </View>

        <LinearGradient
          colors={[colors.summaryStart, colors.summaryEnd]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.summaryCard}
        >
          <View style={styles.summaryTop}>
            <View>
              <Text style={[styles.summaryLabel, { color: colors.summaryMutedForeground }]}>STORAGE SNAPSHOT</Text>
              <Text style={[styles.summaryTitle, { color: colors.summaryForeground }]}>
                {items.length === 0 ? 'Your pantry is ready.' : `${items.length} ${items.length === 1 ? 'item' : 'items'} stored`}
              </Text>
            </View>
            <View style={[styles.jarMark, { backgroundColor: colors.summaryIconBackground }]}>
              <Ionicons name="basket-outline" size={25} color={colors.summaryForeground} />
            </View>
          </View>
          <View style={styles.summaryStats}>
            <View>
              <Text style={[styles.statNumber, { color: colors.summaryForeground }]}>{expiringSoon.length}</Text>
              <Text style={[styles.statLabel, { color: colors.summaryMutedForeground }]}>use soon</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.summaryDivider }]} />
            <View>
              <Text style={[styles.statNumber, { color: colors.summaryForeground }]}>{expired.length}</Text>
              <Text style={[styles.statLabel, { color: colors.summaryMutedForeground }]}>past expiry</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.summaryDivider }]} />
            <View>
              <Text style={[styles.statNumber, { color: colors.summaryForeground }]}>{settings.shelves.length}</Text>
              <Text style={[styles.statLabel, { color: colors.summaryMutedForeground }]}>shelves</Text>
            </View>
          </View>
        </LinearGradient>

        <View style={styles.sectionHeading}>
          <Text style={[styles.sectionTitle, { color: colors.forest }]}>Stored food</Text>
          <Text style={[styles.sectionCount, { color: colors.mutedForeground }]}>
            {filteredItems.length} total
          </Text>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          <Pressable
            onPress={() => setFilterShelf(null)}
            style={[
              styles.filterChip,
              { backgroundColor: !filterShelf ? colors.forest : colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.filterText, { color: !filterShelf ? colors.white : colors.mutedForeground }]}>
              All shelves
            </Text>
          </Pressable>
          {settings.shelves.map((shelf) => (
            <Pressable
              key={shelf}
              onPress={() => setFilterShelf(shelf)}
              style={[
                styles.filterChip,
                { backgroundColor: filterShelf === shelf ? colors.forest : colors.card, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.filterText, { color: filterShelf === shelf ? colors.white : colors.mutedForeground }]}>
                {shelf}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {filteredItems.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.emptyIcon, { backgroundColor: colors.sage }]}>
              <Ionicons name="archive-outline" size={25} color={colors.green} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.forest }]}>
              {items.length === 0 ? 'Nothing stored yet' : 'No food on this shelf'}
            </Text>
            <Text style={[styles.emptyCopy, { color: colors.mutedForeground }]}>
              {items.length === 0
                ? 'Scan a product to start building your long-term food store.'
                : 'Choose another shelf to see the rest of your pantry.'}
            </Text>
            {items.length === 0 && (
              <Pressable
                testID="empty-add-button"
                onPress={() => setShowAdd(true)}
                style={({ pressed }) => [
                  styles.primaryButton,
                  { backgroundColor: colors.green },
                  pressed && styles.pressed,
                ]}
              >
                <Ionicons name="scan-outline" size={18} color={colors.white} />
                <Text style={styles.primaryButtonText}>Scan first item</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <View style={styles.itemList}>
            {filteredItems.map((item) => {
              const tone = itemTone(item, colors);
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Move ${item.name} to another shelf`}
                  onPress={() => setItemToMove(item)}
                  onLongPress={() => void confirmRemove(item)}
                  delayLongPress={450}
                  style={({ pressed }) => [
                    styles.itemCard,
                    { backgroundColor: colors.card, borderColor: colors.border },
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={[styles.itemIcon, { backgroundColor: colors.sage }]}>
                    <Ionicons name="fast-food-outline" size={21} color={colors.green} />
                  </View>
                  <View style={styles.itemMain}>
                    <Text numberOfLines={1} style={[styles.itemName, { color: colors.forest }]}>
                      {item.name}
                    </Text>
                    <View style={styles.itemMeta}>
                      <Feather name="layers" size={12} color={colors.mutedForeground} />
                      <Text style={[styles.itemShelf, { color: colors.mutedForeground }]}>
                        {item.shelf}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.itemExpiry}>
                    <Text style={[styles.itemDate, { color: tone.color }]}>{prettyDate(item.expiryDate)}</Text>
                    <Text style={[styles.itemStatus, { color: tone.color }]}>{tone.label}</Text>
                  </View>
                  {removingId === item.id ? <ActivityIndicator color={colors.terracotta} size="small" /> : null}
                </Pressable>
              );
            })}
          </View>
        )}

        {items.length > 0 ? (
          <Text style={[styles.listHint, { color: colors.mutedForeground }]}>
            Tap an item to move it · Press and hold to remove it
          </Text>
        ) : null}

        <Pressable
          onPress={() => void enableNotifications()}
          style={({ pressed }) => [
            styles.notificationBanner,
            { backgroundColor: colors.accent },
            pressed && styles.pressed,
          ]}
        >
          <View style={[styles.notificationIcon, { backgroundColor: colors.sand }]}>
            <Ionicons name="notifications-outline" size={17} color={colors.amber} />
          </View>
          <View style={styles.notificationCopy}>
            <Text style={[styles.notificationTitle, { color: colors.accentForeground }]}>
              Remind me before food expires
            </Text>
            <Text style={[styles.notificationText, { color: colors.mutedForeground }]}>
              Currently set to {settings.reminderDays} days before expiry
            </Text>
          </View>
          <Feather name="chevron-right" size={18} color={colors.amber} />
        </Pressable>
      </ScrollView>

      <Pressable
        testID="add-item-button"
        accessibilityLabel="Add pantry item"
        onPress={() => setShowAdd(true)}
        style={({ pressed }) => [
          styles.floatingButton,
          { bottom: insets.bottom + 18, backgroundColor: colors.green },
          pressed && styles.floatingPressed,
        ]}
      >
        <Ionicons name="add" size={28} color={colors.white} />
        <Text style={styles.floatingText}>Add food</Text>
      </Pressable>

      <AddItemModal visible={showAdd} onClose={() => setShowAdd(false)} />
      <SettingsModal visible={showSettings} onClose={() => setShowSettings(false)} />
      <MoveItemModal item={itemToMove} onClose={() => setItemToMove(null)} />
    </View>
  );
}

function AddItemModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { settings, openRouterApiKey, addItem } = usePantry();
  const [step, setStep] = useState<AddStep>('product');
  const [cameraMode, setCameraMode] = useState<CaptureMode | null>(null);
  const [analysisState, setAnalysisState] = useState<
    'idle' | 'reading' | 'read' | 'unavailable'
  >('idle');
  const [analysisMessage, setAnalysisMessage] = useState('');
  const [draft, setDraft] = useState<Draft>({
    name: '',
    shelf: settings.shelves[0] ?? 'Top shelf',
    expiryDate: '',
  });
  const [saving, setSaving] = useState(false);
  const [dateError, setDateError] = useState('');

  function reset() {
    setStep('product');
    setCameraMode(null);
    setAnalysisState('idle');
    setAnalysisMessage('');
    setDraft({ name: '', shelf: settings.shelves[0] ?? 'Top shelf', expiryDate: '' });
    setSaving(false);
    setDateError('');
  }

  function close() {
    reset();
    onClose();
  }

  function openCamera(mode: CaptureMode) {
    setCameraMode(mode);
  }

  async function analyzeCapture(uri: string, kind: LabelKind) {
    setAnalysisState('reading');
    setAnalysisMessage('');
    try {
      const result = await readLabelPhoto(uri, kind, settings, openRouterApiKey);
      if (kind === 'product' && result.name) {
        setDraft((current) => ({ ...current, name: result.name ?? current.name }));
      }
      if (kind === 'expiry' && result.expiryDate) {
        setDraft((current) => ({
          ...current,
          expiryDate: result.expiryDate ?? current.expiryDate,
        }));
      }
      setAnalysisState('read');
      setAnalysisMessage(
        kind === 'product'
          ? result.name
            ? 'Product name suggested. You can edit it below.'
            : 'No product name was clear enough to suggest.'
          : result.expiryDate
            ? 'Expiry date suggested. Please confirm it below.'
            : 'No expiry date was clear enough to suggest.',
      );
    } catch (error) {
      setAnalysisState('unavailable');
      setAnalysisMessage(
        error instanceof Error
          ? `${error.message} You can still enter it manually.`
          : 'AI reading was unavailable. You can still enter it manually.',
      );
    }
  }

  async function save() {
    const date = new Date(`${draft.expiryDate}T00:00:00`);
    if (!draft.name.trim()) {
      Alert.alert('Add a name', 'Enter the food name so you can find it later.');
      return;
    }
    if (!draft.expiryDate || Number.isNaN(date.getTime())) {
      setDateError('Enter a date like 2028-06-30');
      return;
    }
    setSaving(true);
    await addItem({
      name: draft.name.trim(),
      shelf: draft.shelf,
      expiryDate: draft.expiryDate,
      productPhotoUri: draft.productPhotoUri,
      expiryPhotoUri: draft.expiryPhotoUri,
      barcode: draft.barcode,
    });
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSaving(false);
    close();
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <View style={[styles.modalScreen, { backgroundColor: colors.background }]}>
        <View style={[styles.modalHeader, { paddingTop: insets.top + 8 }]}>
          <Pressable accessibilityLabel="Close add item" onPress={close} style={styles.modalIconButton}>
            <Ionicons name="close" size={25} color={colors.forest} />
          </Pressable>
          <Text style={[styles.modalTitle, { color: colors.forest }]}>Add food</Text>
          <View style={styles.progressDots}>
            {(['product', 'expiry', 'details'] as AddStep[]).map((part) => (
              <View
                key={part}
                style={[
                  styles.progressDot,
                  { backgroundColor: step === part ? colors.green : colors.border },
                ]}
              />
            ))}
          </View>
        </View>

        <KeyboardAwareScrollViewCompat
          contentContainerStyle={[styles.modalContent, { paddingBottom: insets.bottom + 36 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bottomOffset={20}
        >
          {step === 'product' ? (
            <>
              <Text style={[styles.modalEyebrow, { color: colors.green }]}>STEP 1 OF 3</Text>
              <Text style={[styles.modalHeading, { color: colors.forest }]}>Scan the product</Text>
              <Text style={[styles.modalDescription, { color: colors.mutedForeground }]}>
                Take a clear photo of the label. If there is a barcode, we’ll capture that too.
              </Text>
              <CaptureCard
                mode="product"
                uri={draft.productPhotoUri}
                onPress={() => openCamera('product')}
                colors={colors}
              />
              <AnalysisStatus
                state={analysisState}
                message={analysisMessage}
                colors={colors}
              />
              <Text style={[styles.inputLabel, { color: colors.forest }]}>Product name</Text>
              <TextInput
                testID="product-step-name-input"
                value={draft.name}
                onChangeText={(name) => setDraft((current) => ({ ...current, name }))}
                placeholder="Type the product name"
                placeholderTextColor={colors.mutedForeground}
                style={[styles.textInput, { backgroundColor: colors.card, borderColor: colors.input, color: colors.forest }]}
                autoCapitalize="sentences"
                returnKeyType="done"
              />
              {draft.barcode ? (
                <View style={[styles.detectedRow, { backgroundColor: colors.sage }]}>
                  <Ionicons name="checkmark-circle" size={18} color={colors.green} />
                  <Text style={[styles.detectedText, { color: colors.green }]}>
                    Barcode captured · {draft.barcode}
                  </Text>
                </View>
              ) : null}
              <Pressable
                onPress={() => setStep('expiry')}
                style={({ pressed }) => [
                  styles.fullButton,
                  { backgroundColor: colors.green },
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.fullButtonText}>Continue to expiry date</Text>
                <Feather name="arrow-right" size={18} color={colors.white} />
              </Pressable>
            </>
          ) : null}

          {step === 'expiry' ? (
            <>
              <Text style={[styles.modalEyebrow, { color: colors.green }]}>STEP 2 OF 3</Text>
              <Text style={[styles.modalHeading, { color: colors.forest }]}>Read the expiry</Text>
              <Text style={[styles.modalDescription, { color: colors.mutedForeground }]}>
                Photograph the printed date on the jar or can. We’ll keep the photo with the item so you can check it later.
              </Text>
              <CaptureCard
                mode="expiry"
                uri={draft.expiryPhotoUri}
                onPress={() => openCamera('expiry')}
                colors={colors}
              />
              <AnalysisStatus
                state={analysisState}
                message={analysisMessage}
                colors={colors}
              />
              <Text style={[styles.inputLabel, { color: colors.forest }]}>Expiry date</Text>
              <TextInput
                testID="expiry-step-date-input"
                value={draft.expiryDate}
                onChangeText={(expiryDate) => {
                  setDateError('');
                  setDraft((current) => ({ ...current, expiryDate }));
                }}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="numbers-and-punctuation"
                style={[styles.textInput, { backgroundColor: colors.card, borderColor: colors.input, color: colors.forest }]}
                returnKeyType="done"
              />
              <View style={[styles.infoBox, { backgroundColor: colors.accent }]}>
                <Ionicons name="sparkles-outline" size={18} color={colors.amber} />
                <Text style={[styles.infoText, { color: colors.accentForeground }]}>
                  Confirm the date on the next step before saving.
                </Text>
              </View>
              <Pressable
                onPress={() => setStep('details')}
                style={({ pressed }) => [
                  styles.fullButton,
                  { backgroundColor: colors.green },
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.fullButtonText}>Confirm details</Text>
                <Feather name="arrow-right" size={18} color={colors.white} />
              </Pressable>
              <Pressable onPress={() => setStep('product')} style={styles.backButton}>
                <Feather name="arrow-left" size={16} color={colors.mutedForeground} />
                <Text style={[styles.backButtonText, { color: colors.mutedForeground }]}>Back</Text>
              </Pressable>
            </>
          ) : null}

          {step === 'details' ? (
            <>
              <Text style={[styles.modalEyebrow, { color: colors.green }]}>STEP 3 OF 3</Text>
              <Text style={[styles.modalHeading, { color: colors.forest }]}>Finish the details</Text>
              <Text style={[styles.modalDescription, { color: colors.mutedForeground }]}>
                Give this item a name, confirm the date, and choose where it lives.
              </Text>
              <Text style={[styles.inputLabel, { color: colors.forest }]}>Food name</Text>
              <TextInput
                testID="food-name-input"
                value={draft.name}
                onChangeText={(name) => setDraft((current) => ({ ...current, name }))}
                placeholder="e.g. Lentil stew"
                placeholderTextColor={colors.mutedForeground}
                style={[styles.textInput, { backgroundColor: colors.card, borderColor: colors.input, color: colors.forest }]}
                autoCapitalize="sentences"
              />
              <Text style={[styles.inputLabel, { color: colors.forest }]}>Expiry date</Text>
              <TextInput
                testID="expiry-date-input"
                value={draft.expiryDate}
                onChangeText={(expiryDate) => {
                  setDateError('');
                  setDraft((current) => ({ ...current, expiryDate }));
                }}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="numbers-and-punctuation"
                style={[styles.textInput, { backgroundColor: colors.card, borderColor: dateError ? colors.terracotta : colors.input, color: colors.forest }]}
              />
              {dateError ? <Text style={[styles.errorText, { color: colors.terracotta }]}>{dateError}</Text> : null}
              <Text style={[styles.inputLabel, { color: colors.forest }]}>Shelf</Text>
              <View style={styles.shelfGrid}>
                {settings.shelves.map((shelf) => (
                  <Pressable
                    key={shelf}
                    onPress={() => setDraft((current) => ({ ...current, shelf }))}
                    style={[
                      styles.shelfChoice,
                      {
                        backgroundColor: draft.shelf === shelf ? colors.sage : colors.card,
                        borderColor: draft.shelf === shelf ? colors.green : colors.border,
                      },
                    ]}
                  >
                    <Feather
                      name={draft.shelf === shelf ? 'check-circle' : 'circle'}
                      size={16}
                      color={draft.shelf === shelf ? colors.green : colors.mutedForeground}
                    />
                    <Text style={[styles.shelfChoiceText, { color: draft.shelf === shelf ? colors.green : colors.mutedForeground }]}>
                      {shelf}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Pressable
                testID="save-item-button"
                disabled={saving}
                onPress={() => void save()}
                style={({ pressed }) => [
                  styles.fullButton,
                  { backgroundColor: colors.green, opacity: saving ? 0.7 : 1 },
                  pressed && styles.pressed,
                ]}
              >
                {saving ? <ActivityIndicator color={colors.white} /> : <Ionicons name="checkmark" size={19} color={colors.white} />}
                <Text style={styles.fullButtonText}>Save to pantry</Text>
              </Pressable>
              <Pressable onPress={() => setStep('expiry')} style={styles.backButton}>
                <Feather name="arrow-left" size={16} color={colors.mutedForeground} />
                <Text style={[styles.backButtonText, { color: colors.mutedForeground }]}>Back</Text>
              </Pressable>
            </>
          ) : null}
        </KeyboardAwareScrollViewCompat>
        {cameraMode ? (
          <CameraModal
            mode={cameraMode}
            onClose={() => setCameraMode(null)}
            onCaptured={(uri, barcode) => {
              if (cameraMode === 'product') {
                setDraft((current) => ({
                  ...current,
                  productPhotoUri: uri,
                  barcode: barcode ?? current.barcode,
                  name: current.name || (barcode ? `Product ${barcode}` : ''),
                }));
                void analyzeCapture(uri, 'product');
              } else {
                setDraft((current) => ({ ...current, expiryPhotoUri: uri }));
                void analyzeCapture(uri, 'expiry');
              }
              setCameraMode(null);
            }}
          />
        ) : null}
      </View>
    </Modal>
  );
}

function CaptureCard({
  mode,
  uri,
  onPress,
  colors,
}: {
  mode: CaptureMode;
  uri?: string;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.captureCard, { backgroundColor: colors.card, borderColor: colors.border }, pressed && styles.pressed]}>
      <View style={[styles.captureIcon, { backgroundColor: colors.sage }]}>
        <Ionicons name={uri ? 'refresh-outline' : 'camera-outline'} size={27} color={colors.green} />
      </View>
      <View style={styles.captureCopy}>
        <Text style={[styles.captureTitle, { color: colors.forest }]}>{uri ? 'Retake photo' : mode === 'product' ? 'Take product photo' : 'Take expiry photo'}</Text>
        <Text style={[styles.captureSubtitle, { color: colors.mutedForeground }]}>{uri ? 'Photo saved to this item' : 'Use your camera'}</Text>
      </View>
      <Feather name="chevron-right" size={19} color={colors.mutedForeground} />
    </Pressable>
  );
}

function AnalysisStatus({
  state,
  message,
  colors,
}: {
  state: 'idle' | 'reading' | 'read' | 'unavailable';
  message: string;
  colors: ReturnType<typeof useColors>;
}) {
  if (state === 'idle') return null;
  const isReading = state === 'reading';
  const isUnavailable = state === 'unavailable';
  return (
    <View
      style={[
        styles.analysisRow,
        {
          backgroundColor: isUnavailable
            ? colors.accent
            : state === 'read'
              ? colors.sage
              : colors.muted,
        },
      ]}
    >
      {isReading ? (
        <ActivityIndicator size="small" color={colors.green} />
      ) : (
        <Ionicons
          name={isUnavailable ? 'information-circle-outline' : 'sparkles-outline'}
          size={17}
          color={isUnavailable ? colors.amber : colors.green}
        />
      )}
      <Text
        style={[
          styles.analysisText,
          { color: isUnavailable ? colors.accentForeground : colors.green },
        ]}
      >
        {isReading ? 'Reading label…' : message}
      </Text>
    </View>
  );
}

function CameraModal({
  mode,
  onClose,
  onCaptured,
}: {
  mode: CaptureMode;
  onClose: () => void;
  onCaptured: (uri: string, barcode?: string) => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraView | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [barcode, setBarcode] = useState<string>();
  const [taking, setTaking] = useState(false);

  async function capture() {
    if (!cameraRef.current || taking) return;
    setTaking(true);
    const photo = await cameraRef.current.takePictureAsync({ quality: 0.7 });
    if (photo?.uri) onCaptured(photo.uri, barcode);
    setTaking(false);
  }

  if (!permission) {
    return (
      <Modal visible animationType="fade">
        <View style={[styles.cameraFallback, { backgroundColor: colors.forest }]}>
          <ActivityIndicator color={colors.white} />
        </View>
      </Modal>
    );
  }

  if (!permission.granted) {
    return (
      <Modal visible animationType="slide" onRequestClose={onClose}>
        <View style={[styles.permissionScreen, { backgroundColor: colors.background, paddingTop: insets.top + 20 }]}>
          <Pressable onPress={onClose} style={styles.permissionClose}>
            <Ionicons name="close" size={25} color={colors.forest} />
          </Pressable>
          <View style={[styles.permissionIcon, { backgroundColor: colors.sage }]}>
            <Ionicons name="camera-outline" size={40} color={colors.green} />
          </View>
          <Text style={[styles.permissionTitle, { color: colors.forest }]}>Camera access needed</Text>
          <Text style={[styles.permissionCopy, { color: colors.mutedForeground }]}>
            Pantry Keeper uses your camera to capture the product label and expiry date.
          </Text>
          <Pressable
            onPress={() => {
              if (permission.canAskAgain) {
                void requestPermission();
              } else {
                Alert.alert('Camera access is blocked', 'Enable camera access in Android Settings to scan pantry items.');
              }
            }}
            style={({ pressed }) => [styles.fullButton, { backgroundColor: colors.green }, pressed && styles.pressed]}
          >
            <Text style={styles.fullButtonText}>{permission.canAskAgain ? 'Allow camera' : 'Open settings'}</Text>
          </Pressable>
          <Pressable onPress={onClose} style={styles.backButton}>
            <Text style={[styles.backButtonText, { color: colors.mutedForeground }]}>Not now</Text>
          </Pressable>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={styles.cameraScreen}>
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={mode === 'product' ? { barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128'] } : undefined}
          onBarcodeScanned={
            mode === 'product' && !barcode
              ? ({ data }) => setBarcode(data)
              : undefined
          }
        />
        <View style={[styles.cameraTop, { paddingTop: insets.top + 10 }]}>
          <Pressable onPress={onClose} style={styles.cameraClose}>
            <Ionicons name="close" size={25} color={colors.white} />
          </Pressable>
          <Text style={styles.cameraTitle}>{mode === 'product' ? 'Product label' : 'Expiry date'}</Text>
          <View style={styles.cameraTopSpacer} />
        </View>
        <View style={styles.cameraFrameWrap}>
          <View style={styles.cameraFrame} />
          <Text style={styles.cameraHint}>
            {mode === 'product' ? 'Fit the label inside the frame' : 'Fit the printed date inside the frame'}
          </Text>
          {barcode ? (
            <View style={styles.barcodeBadge}>
              <Ionicons name="barcode-outline" size={15} color={colors.forest} />
              <Text style={[styles.barcodeText, { color: colors.forest }]}>Barcode found</Text>
            </View>
          ) : null}
        </View>
        <View style={[styles.cameraBottom, { paddingBottom: insets.bottom + 22 }]}>
          <Text style={styles.cameraModeLabel}>{mode === 'product' ? 'PRODUCT' : 'EXPIRY'}</Text>
          <Pressable
            testID="camera-capture-button"
            onPress={() => void capture()}
            style={({ pressed }) => [styles.shutter, pressed && styles.shutterPressed]}
          >
            {taking ? <ActivityIndicator color={colors.forest} /> : <View style={[styles.shutterInner, { backgroundColor: colors.white }]} />}
          </Pressable>
          <View style={styles.cameraBottomSpacer} />
        </View>
      </View>
    </Modal>
  );
}

function SettingsModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    settings,
    openRouterApiKey,
    updateOpenRouterApiKey,
    updateSettings,
    requestNotificationPermission,
  } = usePantry();
  const [newShelf, setNewShelf] = useState('');
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [savingApiKey, setSavingApiKey] = useState(false);

  useEffect(() => {
    if (visible) setApiKeyDraft(openRouterApiKey);
  }, [visible, openRouterApiKey]);

  async function addShelf() {
    const value = newShelf.trim();
    if (!value || settings.shelves.includes(value)) return;
    await updateSettings({ shelves: [...settings.shelves, value] });
    setNewShelf('');
  }

  async function saveApiKey(key: string) {
    setSavingApiKey(true);
    try {
      await updateOpenRouterApiKey(key);
      setApiKeyDraft(key.trim());
    } catch {
      setApiKeyDraft(openRouterApiKey);
      Alert.alert(
        'Could not save key',
        'Secure storage is unavailable. Your existing key was not changed.',
      );
    } finally {
      setSavingApiKey(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.modalScreen, { backgroundColor: colors.background }]}>
        <View style={[styles.modalHeader, { paddingTop: insets.top + 8 }]}>
          <Pressable onPress={onClose} style={styles.modalIconButton}>
            <Ionicons name="close" size={25} color={colors.forest} />
          </Pressable>
          <Text style={[styles.modalTitle, { color: colors.forest }]}>Settings</Text>
          <View style={styles.modalHeaderSpacer} />
        </View>
        <KeyboardAwareScrollViewCompat
          contentContainerStyle={[styles.modalContent, { paddingBottom: insets.bottom + 36 }]}
          showsVerticalScrollIndicator={false}
          bottomOffset={20}
        >
          <Text style={[styles.modalEyebrow, { color: colors.green }]}>REMINDERS</Text>
          <Text style={[styles.modalHeading, { color: colors.forest }]}>Choose your lead time</Text>
          <Text style={[styles.modalDescription, { color: colors.mutedForeground }]}>
            Pantry Keeper will remind you this many days before an item expires.
          </Text>
          <View style={styles.reminderRow}>
            {[7, 14, 30, 60].map((days) => (
              <Pressable
                key={days}
                onPress={() => void updateSettings({ reminderDays: days })}
                style={[
                  styles.reminderChoice,
                  {
                    backgroundColor: settings.reminderDays === days ? colors.green : colors.card,
                    borderColor: settings.reminderDays === days ? colors.green : colors.border,
                  },
                ]}
              >
                <Text style={[styles.reminderNumber, { color: settings.reminderDays === days ? colors.white : colors.forest }]}>
                  {days}
                </Text>
                <Text style={[styles.reminderLabel, { color: settings.reminderDays === days ? colors.white : colors.mutedForeground }]}>
                  days
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            onPress={() => void requestNotificationPermission()}
            style={({ pressed }) => [styles.secondaryButton, { borderColor: colors.green }, pressed && styles.pressed]}
          >
            <Ionicons name="notifications-outline" size={18} color={colors.green} />
            <Text style={[styles.secondaryButtonText, { color: colors.green }]}>Enable notifications</Text>
          </Pressable>

          <View style={styles.settingsDivider} />
          <Text style={[styles.modalEyebrow, { color: colors.green }]}>LABEL READING</Text>
          <Text style={[styles.modalHeading, { color: colors.forest }]}>Choose your AI</Text>
          <Text style={[styles.modalDescription, { color: colors.mutedForeground }]}>
            OpenRouter is hosted and private to this project. Local AI keeps photos on your network and works with an OpenAI-compatible endpoint.
          </Text>
          <View style={styles.providerRow}>
            {[
              { key: 'openrouter' as const, label: 'OpenRouter', icon: 'cloud-outline' as const },
              { key: 'local' as const, label: 'Local AI', icon: 'hardware-chip-outline' as const },
            ].map((provider) => (
              <Pressable
                key={provider.key}
                onPress={() => void updateSettings({ aiProvider: provider.key })}
                style={[
                  styles.providerChoice,
                  {
                    backgroundColor: settings.aiProvider === provider.key ? colors.sage : colors.card,
                    borderColor: settings.aiProvider === provider.key ? colors.green : colors.border,
                  },
                ]}
              >
                <Ionicons
                  name={provider.icon}
                  size={18}
                  color={settings.aiProvider === provider.key ? colors.green : colors.mutedForeground}
                />
                <Text
                  style={[
                    styles.providerChoiceText,
                    { color: settings.aiProvider === provider.key ? colors.green : colors.mutedForeground },
                  ]}
                >
                  {provider.label}
                </Text>
              </Pressable>
            ))}
          </View>
          {settings.aiProvider === 'openrouter' ? (
            <>
              <Text style={[styles.inputLabel, { color: colors.forest }]}>OpenRouter vision model</Text>
              <TextInput
                value={settings.openRouterModel}
                onChangeText={(openRouterModel) => void updateSettings({ openRouterModel })}
                placeholder="google/gemini-3.8-flash"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                style={[styles.textInput, { backgroundColor: colors.card, borderColor: colors.input, color: colors.forest }]}
              />
              <Text style={[styles.settingsHint, { color: colors.mutedForeground }]}>
                The hosted default uses Google Gemini through OpenRouter, not xAI.
              </Text>
              <Text style={[styles.inputLabel, { color: colors.forest }]}>Your OpenRouter API key</Text>
              <TextInput
                testID="openrouter-api-key-input"
                value={apiKeyDraft}
                onChangeText={setApiKeyDraft}
                placeholder="sk-or-…"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                style={[styles.textInput, { backgroundColor: colors.card, borderColor: colors.input, color: colors.forest }]}
                returnKeyType="done"
              />
              <Text style={[styles.settingsHint, { color: colors.mutedForeground }]}>
                Stored securely on this device. Sent to Pantry Keeper’s API only when you scan a label.
              </Text>
              <View style={styles.apiKeyActions}>
                <Pressable
                  testID="save-openrouter-api-key"
                  disabled={savingApiKey}
                  onPress={() => void saveApiKey(apiKeyDraft)}
                  style={({ pressed }) => [
                    styles.apiKeySaveButton,
                    { backgroundColor: colors.green, opacity: savingApiKey ? 0.7 : 1 },
                    pressed && styles.pressed,
                  ]}
                >
                  {savingApiKey ? (
                    <ActivityIndicator size="small" color={colors.white} />
                  ) : (
                    <Ionicons name="lock-closed-outline" size={16} color={colors.white} />
                  )}
                  <Text style={styles.apiKeySaveText}>Save key</Text>
                </Pressable>
                {openRouterApiKey ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={savingApiKey}
                    onPress={() => void saveApiKey('')}
                    style={({ pressed }) => [styles.apiKeyClearButton, pressed && styles.pressed]}
                  >
                    <Text style={[styles.apiKeyClearText, { color: colors.terracotta }]}>Remove key</Text>
                  </Pressable>
                ) : null}
              </View>
            </>
          ) : (
            <>
              <Text style={[styles.inputLabel, { color: colors.forest }]}>Local AI base URL</Text>
              <TextInput
                value={settings.localBaseUrl}
                onChangeText={(localBaseUrl) => void updateSettings({ localBaseUrl })}
                placeholder="http://192.168.1.20:11434/v1"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                style={[styles.textInput, { backgroundColor: colors.card, borderColor: colors.input, color: colors.forest }]}
              />
              <Text style={[styles.inputLabel, { color: colors.forest }]}>Local model</Text>
              <TextInput
                value={settings.localModel}
                onChangeText={(localModel) => void updateSettings({ localModel })}
                placeholder="llama3.2-vision"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                style={[styles.textInput, { backgroundColor: colors.card, borderColor: colors.input, color: colors.forest }]}
              />
              <Text style={[styles.inputLabel, { color: colors.forest }]}>Local API key (optional)</Text>
              <TextInput
                value={settings.localApiKey}
                onChangeText={(localApiKey) => void updateSettings({ localApiKey })}
                placeholder="Only needed if your local server requires one"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                style={[styles.textInput, { backgroundColor: colors.card, borderColor: colors.input, color: colors.forest }]}
              />
              <Text style={[styles.settingsHint, { color: colors.mutedForeground }]}>
                On Android, use the computer’s LAN IP instead of 127.0.0.1. The phone and AI server must be reachable from the same network.
              </Text>
            </>
          )}

          <View style={styles.settingsDivider} />
          <Text style={[styles.modalEyebrow, { color: colors.green }]}>STORAGE</Text>
          <Text style={[styles.modalHeading, { color: colors.forest }]}>Your shelves</Text>
          <Text style={[styles.modalDescription, { color: colors.mutedForeground }]}>
            Name shelves, cupboards, or any other storage spots by hand.
          </Text>
          {settings.shelves.map((shelf) => (
            <View key={shelf} style={[styles.shelfRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Ionicons name="layers-outline" size={18} color={colors.green} />
              <Text style={[styles.shelfRowText, { color: colors.forest }]}>{shelf}</Text>
            </View>
          ))}
          <View style={styles.addShelfRow}>
            <TextInput
              value={newShelf}
              onChangeText={setNewShelf}
              placeholder="New shelf name"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.shelfInput, { backgroundColor: colors.card, borderColor: colors.input, color: colors.forest }]}
              onSubmitEditing={() => void addShelf()}
              returnKeyType="done"
            />
            <Pressable
              accessibilityLabel="Add shelf"
              onPress={() => void addShelf()}
              style={({ pressed }) => [styles.addShelfButton, { backgroundColor: colors.sage }, pressed && styles.pressed]}
            >
              <Ionicons name="add" size={22} color={colors.green} />
            </Pressable>
          </View>
        </KeyboardAwareScrollViewCompat>
      </View>
    </Modal>
  );
}

function MoveItemModal({
  item,
  onClose,
}: {
  item: PantryItem | null;
  onClose: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { settings, moveItemToShelf } = usePantry();
  const [moving, setMoving] = useState(false);

  async function moveToShelf(shelf: string) {
    if (!item || moving || shelf === item.shelf) return;
    setMoving(true);
    try {
      await moveItemToShelf(item.id, shelf);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
    } catch {
      Alert.alert(
        'Item moved',
        `${item.name} is now on ${shelf}, but its reminder may still mention the previous shelf.`,
      );
      onClose();
    } finally {
      setMoving(false);
    }
  }

  return (
    <Modal visible={item !== null} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.modalScreen, { backgroundColor: colors.background }]}>
        <View style={[styles.modalHeader, { paddingTop: insets.top + 8 }]}>
          <Pressable accessibilityLabel="Close move item" onPress={onClose} style={styles.modalIconButton}>
            <Ionicons name="close" size={25} color={colors.forest} />
          </Pressable>
          <Text style={[styles.modalTitle, { color: colors.forest }]}>Move item</Text>
          <View style={styles.modalHeaderSpacer} />
        </View>
        <ScrollView
          contentContainerStyle={[styles.modalContent, { paddingBottom: insets.bottom + 36 }]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={[styles.modalEyebrow, { color: colors.green }]}>STORAGE</Text>
          <Text style={[styles.modalHeading, { color: colors.forest }]}>Choose a shelf</Text>
          <Text style={[styles.modalDescription, { color: colors.mutedForeground }]}>
            {item ? `${item.name} is currently on ${item.shelf}.` : ''}
          </Text>
          <View style={styles.shelfGrid}>
            {settings.shelves.map((shelf) => {
              const isCurrentShelf = shelf === item?.shelf;
              return (
                <Pressable
                  key={shelf}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isCurrentShelf, disabled: moving || isCurrentShelf }}
                  disabled={moving || isCurrentShelf}
                  onPress={() => void moveToShelf(shelf)}
                  style={[
                    styles.shelfChoice,
                    {
                      backgroundColor: isCurrentShelf ? colors.sage : colors.card,
                      borderColor: isCurrentShelf ? colors.green : colors.border,
                      opacity: moving ? 0.7 : 1,
                    },
                  ]}
                >
                  <Feather
                    name={isCurrentShelf ? 'check-circle' : 'circle'}
                    size={16}
                    color={isCurrentShelf ? colors.green : colors.mutedForeground}
                  />
                  <Text style={[styles.shelfChoiceText, { color: isCurrentShelf ? colors.green : colors.forest }]}>
                    {shelf}{isCurrentShelf ? ' · current' : ''}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {settings.shelves.length < 2 ? (
            <Text style={[styles.settingsHint, { color: colors.mutedForeground }]}>
              Add another shelf in Settings to move this item.
            </Text>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

export default function Index() {
  return (
    <PantryProvider>
      <HomeScreen />
    </PantryProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scrollContent: { paddingHorizontal: 20 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22 },
  eyebrow: { fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 1.8, marginBottom: 7 },
  heading: { fontSize: 34, lineHeight: 37, fontFamily: 'Inter_700Bold', letterSpacing: -1 },
  iconButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  pressed: { opacity: 0.72 },
  summaryCard: { borderRadius: 25, padding: 20, marginBottom: 28 },
  summaryTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryLabel: { fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 1.5, marginBottom: 8 },
  summaryTitle: { fontSize: 20, fontFamily: 'Inter_600SemiBold', letterSpacing: -0.3 },
  jarMark: { width: 49, height: 49, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  summaryStats: { flexDirection: 'row', alignItems: 'center', marginTop: 26 },
  statNumber: { fontSize: 23, fontFamily: 'Inter_700Bold' },
  statLabel: { fontSize: 11, fontFamily: 'Inter_500Medium', marginTop: 2 },
  statDivider: { width: 1, height: 32, marginHorizontal: 23 },
  sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 },
  sectionTitle: { fontSize: 21, fontFamily: 'Inter_700Bold', letterSpacing: -0.4 },
  sectionCount: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  filterRow: { gap: 8, paddingBottom: 17 },
  filterChip: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 13, paddingVertical: 8 },
  filterText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  emptyCard: { borderWidth: 1, borderRadius: 22, padding: 24, alignItems: 'center', marginTop: 3 },
  emptyIcon: { width: 56, height: 56, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  emptyTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', marginBottom: 7 },
  emptyCopy: { fontSize: 13, lineHeight: 20, fontFamily: 'Inter_400Regular', textAlign: 'center', maxWidth: 275 },
  primaryButton: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingHorizontal: 17, paddingVertical: 12, borderRadius: 15, marginTop: 20 },
  primaryButtonText: { color: '#fffdf8', fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  itemList: { gap: 9 },
  itemCard: { minHeight: 77, borderWidth: 1, borderRadius: 18, padding: 12, flexDirection: 'row', alignItems: 'center' },
  itemIcon: { width: 43, height: 43, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  itemMain: { flex: 1, minWidth: 0 },
  itemName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', marginBottom: 6 },
  itemMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  itemShelf: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  itemExpiry: { alignItems: 'flex-end', marginLeft: 8 },
  itemDate: { fontSize: 12, fontFamily: 'Inter_600SemiBold', marginBottom: 4 },
  itemStatus: { fontSize: 10, fontFamily: 'Inter_500Medium' },
  listHint: { fontSize: 11, fontFamily: 'Inter_400Regular', textAlign: 'center', marginTop: 13 },
  notificationBanner: { borderRadius: 18, padding: 13, flexDirection: 'row', alignItems: 'center', marginTop: 27 },
  notificationIcon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  notificationCopy: { flex: 1 },
  notificationTitle: { fontSize: 12, fontFamily: 'Inter_600SemiBold', marginBottom: 3 },
  notificationText: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  floatingButton: { position: 'absolute', right: 20, minHeight: 52, paddingHorizontal: 18, borderRadius: 27, flexDirection: 'row', alignItems: 'center', gap: 7, elevation: 6, shadowColor: '#173128', shadowOpacity: 0.22, shadowOffset: { width: 0, height: 4 }, shadowRadius: 9 },
  floatingPressed: { opacity: 0.86, transform: [{ scale: 0.97 }] },
  floatingText: { color: '#fffdf8', fontSize: 13, fontFamily: 'Inter_700Bold' },
  modalScreen: { flex: 1 },
  modalHeader: { paddingHorizontal: 20, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalIconButton: { width: 35, height: 35, alignItems: 'flex-start', justifyContent: 'center' },
  modalHeaderSpacer: { width: 35 },
  modalTitle: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  progressDots: { width: 35, flexDirection: 'row', justifyContent: 'flex-end', gap: 4 },
  progressDot: { width: 6, height: 6, borderRadius: 3 },
  modalContent: { padding: 20 },
  modalEyebrow: { fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 1.6, marginBottom: 9 },
  modalHeading: { fontSize: 28, lineHeight: 32, fontFamily: 'Inter_700Bold', letterSpacing: -0.7, marginBottom: 8 },
  modalDescription: { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_400Regular', marginBottom: 22 },
  captureCard: { borderWidth: 1, borderRadius: 20, padding: 14, flexDirection: 'row', alignItems: 'center', marginBottom: 13 },
  captureIcon: { width: 49, height: 49, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  captureCopy: { flex: 1 },
  captureTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', marginBottom: 4 },
  captureSubtitle: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  detectedRow: { borderRadius: 13, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 14 },
  detectedText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  fullButton: { minHeight: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9, marginTop: 20 },
  fullButtonText: { color: '#fffdf8', fontSize: 14, fontFamily: 'Inter_700Bold' },
  backButton: { minHeight: 42, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7, marginTop: 8 },
  backButtonText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  infoBox: { borderRadius: 15, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 9 },
  infoText: { flex: 1, fontSize: 12, lineHeight: 18, fontFamily: 'Inter_500Medium' },
  inputLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', marginBottom: 8, marginTop: 12 },
  textInput: { minHeight: 51, borderWidth: 1, borderRadius: 15, paddingHorizontal: 14, fontSize: 14, fontFamily: 'Inter_400Regular' },
  errorText: { fontSize: 11, fontFamily: 'Inter_500Medium', marginTop: 6 },
  shelfGrid: { gap: 8 },
  shelfChoice: { minHeight: 46, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 9 },
  shelfChoiceText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  cameraScreen: { flex: 1, backgroundColor: '#101713' },
  cameraTop: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cameraClose: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(0,0,0,0.3)', alignItems: 'center', justifyContent: 'center' },
  cameraTitle: { color: '#fffdf8', fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  cameraTopSpacer: { width: 38 },
  cameraFrameWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cameraFrame: { width: '78%', aspectRatio: 1.15, borderWidth: 2, borderColor: '#fffdf8', borderRadius: 24, opacity: 0.9 },
  cameraHint: { color: '#fffdf8', fontSize: 12, fontFamily: 'Inter_500Medium', marginTop: 20, opacity: 0.85 },
  barcodeBadge: { marginTop: 14, backgroundColor: '#f4e5c3', paddingHorizontal: 11, paddingVertical: 7, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 6 },
  barcodeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  cameraBottom: { alignItems: 'center', justifyContent: 'center', flexDirection: 'row', paddingHorizontal: 30 },
  cameraModeLabel: { width: 64, color: '#fffdf8', fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 1.5, opacity: 0.8 },
  cameraBottomSpacer: { width: 64 },
  shutter: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: '#fffdf8', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 62, height: 62, borderRadius: 31 },
  shutterPressed: { transform: [{ scale: 0.93 }] },
  permissionScreen: { flex: 1, paddingHorizontal: 28, alignItems: 'center' },
  permissionClose: { alignSelf: 'flex-start', width: 36, height: 36, justifyContent: 'center' },
  permissionIcon: { width: 88, height: 88, borderRadius: 30, alignItems: 'center', justifyContent: 'center', marginTop: 100, marginBottom: 22 },
  permissionTitle: { fontSize: 25, fontFamily: 'Inter_700Bold', letterSpacing: -0.5, marginBottom: 10 },
  permissionCopy: { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_400Regular', textAlign: 'center', maxWidth: 300 },
  cameraFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  secondaryButton: { minHeight: 48, borderWidth: 1, borderRadius: 15, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, marginTop: 17 },
  secondaryButtonText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  settingsDivider: { height: 1, backgroundColor: '#dedfd5', marginVertical: 29 },
  reminderRow: { flexDirection: 'row', gap: 8 },
  reminderChoice: { flex: 1, minHeight: 65, borderWidth: 1, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  reminderNumber: { fontSize: 19, fontFamily: 'Inter_700Bold' },
  reminderLabel: { fontSize: 10, fontFamily: 'Inter_500Medium', marginTop: 2 },
  shelfRow: { minHeight: 49, borderWidth: 1, borderRadius: 14, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  shelfRowText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  addShelfRow: { flexDirection: 'row', gap: 8, marginTop: 5 },
  shelfInput: { flex: 1, minHeight: 48, borderWidth: 1, borderRadius: 14, paddingHorizontal: 13, fontSize: 13, fontFamily: 'Inter_400Regular' },
  addShelfButton: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  analysisRow: { borderRadius: 13, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  analysisText: { flex: 1, fontSize: 11, lineHeight: 17, fontFamily: 'Inter_500Medium' },
  providerRow: { flexDirection: 'row', gap: 8, marginBottom: 3 },
  providerChoice: { flex: 1, minHeight: 48, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  providerChoiceText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  settingsHint: { fontSize: 11, lineHeight: 17, fontFamily: 'Inter_400Regular', marginTop: 7 },
  apiKeyActions: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 },
  apiKeySaveButton: { minHeight: 45, borderRadius: 14, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7 },
  apiKeySaveText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  apiKeyClearButton: { minHeight: 42, justifyContent: 'center', paddingHorizontal: 8 },
  apiKeyClearText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
});