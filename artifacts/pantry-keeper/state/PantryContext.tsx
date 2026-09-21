import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import React, {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Platform } from 'react-native';

export type PantryItem = {
  id: string;
  name: string;
  shelf: string;
  expiryDate: string;
  productPhotoUri?: string;
  expiryPhotoUri?: string;
  barcode?: string;
  addedAt: string;
};

export type PantrySettings = {
  shelves: string[];
  reminderDays: number;
};

type ItemDraft = Omit<PantryItem, 'id' | 'addedAt'>;

type PantryContextValue = {
  items: PantryItem[];
  settings: PantrySettings;
  isHydrated: boolean;
  addItem: (draft: ItemDraft) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
  updateSettings: (patch: Partial<PantrySettings>) => Promise<void>;
  requestNotificationPermission: () => Promise<boolean>;
};

const ITEMS_KEY = '@pantry-keeper/items';
const SETTINGS_KEY = '@pantry-keeper/settings';
const DEFAULT_SETTINGS: PantrySettings = {
  shelves: ['Top shelf', 'Middle shelf', 'Bottom shelf'],
  reminderDays: 30,
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

const PantryContext = createContext<PantryContextValue | null>(null);

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function reminderDate(expiryDate: string, days: number) {
  const expiry = new Date(`${expiryDate}T09:00:00`);
  expiry.setDate(expiry.getDate() - days);
  return expiry;
}

export function PantryProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<PantryItem[]>([]);
  const [settings, setSettings] = useState<PantrySettings>(DEFAULT_SETTINGS);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    async function hydrate() {
      try {
        const [storedItems, storedSettings] = await Promise.all([
          AsyncStorage.getItem(ITEMS_KEY),
          AsyncStorage.getItem(SETTINGS_KEY),
        ]);
        if (storedItems) {
          setItems(JSON.parse(storedItems) as PantryItem[]);
        }
        if (storedSettings) {
          setSettings({
            ...DEFAULT_SETTINGS,
            ...(JSON.parse(storedSettings) as Partial<PantrySettings>),
          });
        }
      } catch {
        // A fresh local store is a safe fallback if storage is unavailable.
      } finally {
        setIsHydrated(true);
      }
    }
    void hydrate();
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    void AsyncStorage.setItem(ITEMS_KEY, JSON.stringify(items));
  }, [items, isHydrated]);

  useEffect(() => {
    if (!isHydrated) return;
    void AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings, isHydrated]);

  const scheduleReminders = async (
    reminderItems: PantryItem[],
    reminderDays: number,
  ) => {
    if (Platform.OS === 'web') return;
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) return;
    await Notifications.cancelAllScheduledNotificationsAsync();
    for (const item of reminderItems) {
      const date = reminderDate(item.expiryDate, reminderDays);
      if (date.getTime() <= Date.now()) continue;
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Pantry check-in',
          body: `${item.name} on ${item.shelf} is ready to use soon.`,
          data: { itemId: item.id },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date,
        },
      });
    }
  };

  const requestNotificationPermission = async () => {
    if (Platform.OS === 'web') return false;
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    const requested = await Notifications.requestPermissionsAsync();
    if (requested.granted) {
      await scheduleReminders(items, settings.reminderDays);
    }
    return requested.granted;
  };

  const addItem = async (draft: ItemDraft) => {
    const item: PantryItem = {
      ...draft,
      id: makeId(),
      addedAt: new Date().toISOString(),
    };
    setItems((current) => [item, ...current]);

    await scheduleReminders([...items, item], settings.reminderDays);
  };

  const removeItem = async (id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  };

  const updateSettings = async (patch: Partial<PantrySettings>) => {
    const nextSettings = { ...settings, ...patch };
    setSettings(nextSettings);
    if (patch.reminderDays !== undefined) {
      await scheduleReminders(items, nextSettings.reminderDays);
    }
  };

  const value = useMemo(
    () => ({
      items,
      settings,
      isHydrated,
      addItem,
      removeItem,
      updateSettings,
      requestNotificationPermission,
    }),
    [items, settings, isHydrated],
  );

  return (
    <PantryContext.Provider value={value}>{children}</PantryContext.Provider>
  );
}

export function usePantry() {
  const context = useContext(PantryContext);
  if (!context) {
    throw new Error('usePantry must be used within PantryProvider');
  }
  return context;
}