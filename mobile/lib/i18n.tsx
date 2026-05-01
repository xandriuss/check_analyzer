import * as SecureStore from "expo-secure-store";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";

export type AppLanguage = "en" | "lt" | "ru";

const LANGUAGE_KEY = "receipt-lens-language";

const translations = {
  en: {
    data: "Data",
    camera: "Camera",
    profile: "Profile",
    receipts: "Receipts",
    receiptInfo: "Receipt info",
    graphs: "Graphs",
    bugReports: "Bug reports",
    bugReportsHelp: "Send feedback and view admin reports.",
    settingsHelp: "Dark mode, language, app updates, and junk exclusions.",
    debug: "Debug",
    debugHelp: "Developer scan details and parsed receipt data.",
    viewPro: "View Pro",
    settings: "Settings",
    preferences: "Preferences",
    language: "Language",
    languageHelp: "Choose the language used by the app interface.",
    darkMode: "Dark mode",
    darkModeHelp: "Use a dark background with light text.",
    appUpdates: "App updates",
    checkForUpdates: "Check for updates",
    junkExclusions: "Junk exclusions",
    junkWarning:
      "Warning: removing words like cola, beer, chips, or gummies can reduce the app's ability to help you save money.",
    add: "Add",
    remove: "Remove",
    logOut: "Log out",
    totalSpent: "Total spent",
    junkWaste: "Junk waste",
    depositNeutral: "Deposit",
    usefulSpending: "Useful spending",
    subscribe: "Subscribe",
    subscriptionInsights: "Subscription insights",
    wasteShare: "Waste share",
    monthlyTotal: "Monthly total",
    monthlyJunk: "Monthly junk",
    monthlyDeposit: "Monthly deposit",
    monthlyUseful: "Monthly useful spending",
    monthlyWasteShare: "Monthly waste share",
    noReceipts: "No scanned receipts yet.",
    spendingTrend: "Spending trend",
    graphHelp: "The timeline starts from your first receipt in this range.",
    wasteByCategory: "Waste by category",
    wasteByCategoryHelp: "Only four groups: drinks, foods, candies, and lottery.",
    drinks: "Drinks",
    foods: "Foods",
    candies: "Candies",
    lottery: "Lottery",
    junkFood: "Junk food",
    usefulFood: "Useful food spending",
    week: "Week",
    month: "Month",
    year: "Year",
    scanToGraph: "Scan a receipt to start building your graph.",
  },
  lt: {
    data: "Duomenys",
    camera: "Kamera",
    profile: "Profilis",
    receipts: "Kvitai",
    receiptInfo: "Kvito informacija",
    graphs: "Grafikai",
    bugReports: "Klaidų pranešimai",
    bugReportsHelp: "Siųsk atsiliepimus ir peržiūrėk administratoriaus pranešimus.",
    settingsHelp: "Tamsus režimas, kalba, atnaujinimai ir išimtys iš nesveiko maisto.",
    debug: "Derinimas",
    debugHelp: "Kūrėjo skenavimo detalės ir nuskaityti kvito duomenys.",
    viewPro: "Peržiūrėti Pro",
    settings: "Nustatymai",
    preferences: "Parinktys",
    language: "Kalba",
    languageHelp: "Pasirink programėlės sąsajos kalbą.",
    darkMode: "Tamsus režimas",
    darkModeHelp: "Naudoti tamsų foną ir šviesų tekstą.",
    appUpdates: "Programėlės atnaujinimai",
    checkForUpdates: "Tikrinti atnaujinimus",
    junkExclusions: "Išimtys iš nesveiko maisto",
    junkWarning:
      "Įspėjimas: pašalinus tokius žodžius kaip kola, alus, traškučiai ar guminukai, programėlė gali prasčiau padėti taupyti pinigus.",
    add: "Pridėti",
    remove: "Pašalinti",
    logOut: "Atsijungti",
    totalSpent: "Iš viso išleista",
    junkWaste: "Nesveikam maistui",
    depositNeutral: "Depozitas",
    usefulSpending: "Naudingos išlaidos",
    subscribe: "Prenumeruoti",
    subscriptionInsights: "Prenumeratos įžvalgos",
    wasteShare: "Išlaidų dalis",
    monthlyTotal: "Mėnesio suma",
    monthlyJunk: "Mėnesio nesveikas maistas",
    monthlyDeposit: "Mėnesio depozitas",
    monthlyUseful: "Mėnesio naudingos išlaidos",
    monthlyWasteShare: "Mėnesio išlaidų dalis",
    noReceipts: "Dar nėra nuskenuotų kvitų.",
    spendingTrend: "Išlaidų pokytis",
    graphHelp: "Laiko juosta prasideda nuo pirmo tavo kvito šiame laikotarpyje.",
    wasteByCategory: "Išlaidos pagal kategoriją",
    wasteByCategoryHelp: "Tik keturios grupės: gėrimai, maistas, saldumynai ir loterija.",
    drinks: "Gėrimai",
    foods: "Maistas",
    candies: "Saldumynai",
    lottery: "Loterija",
    junkFood: "Nesveikas maistas",
    usefulFood: "Naudingam maistui išleista",
    week: "Savaitė",
    month: "Mėnuo",
    year: "Metai",
    scanToGraph: "Nuskenuok kvitą, kad pradėtum kurti grafiką.",
  },
  ru: {
    data: "Данные",
    camera: "Камера",
    profile: "Профиль",
    receipts: "Чеки",
    receiptInfo: "Информация о чеке",
    graphs: "Графики",
    bugReports: "Отчеты об ошибках",
    bugReportsHelp: "Отправляйте отзывы и смотрите отчеты администратора.",
    settingsHelp: "Темный режим, язык, обновления и исключения вредной еды.",
    debug: "Отладка",
    debugHelp: "Детали сканирования для разработчика и распознанные данные чека.",
    viewPro: "Посмотреть Pro",
    settings: "Настройки",
    preferences: "Параметры",
    language: "Язык",
    languageHelp: "Выберите язык интерфейса приложения.",
    darkMode: "Темный режим",
    darkModeHelp: "Использовать темный фон и светлый текст.",
    appUpdates: "Обновления приложения",
    checkForUpdates: "Проверить обновления",
    junkExclusions: "Исключения вредной еды",
    junkWarning:
      "Предупреждение: удаление слов вроде cola, beer, chips или gummies может снизить способность приложения помогать экономить деньги.",
    add: "Добавить",
    remove: "Удалить",
    logOut: "Выйти",
    totalSpent: "Всего потрачено",
    junkWaste: "Вредная еда",
    depositNeutral: "Депозит",
    usefulSpending: "Полезные траты",
    subscribe: "Подписаться",
    subscriptionInsights: "Статистика подписки",
    wasteShare: "Доля трат",
    monthlyTotal: "Сумма за месяц",
    monthlyJunk: "Вредная еда за месяц",
    monthlyDeposit: "Депозит за месяц",
    monthlyUseful: "Полезные траты за месяц",
    monthlyWasteShare: "Доля за месяц",
    noReceipts: "Пока нет отсканированных чеков.",
    spendingTrend: "Динамика расходов",
    graphHelp: "График начинается с вашего первого чека в выбранном периоде.",
    wasteByCategory: "Траты по категориям",
    wasteByCategoryHelp: "Только четыре группы: напитки, еда, сладости и лотерея.",
    drinks: "Напитки",
    foods: "Еда",
    candies: "Сладости",
    lottery: "Лотерея",
    junkFood: "Вредная еда",
    usefulFood: "Расходы на полезную еду",
    week: "Неделя",
    month: "Месяц",
    year: "Год",
    scanToGraph: "Отсканируйте чек, чтобы начать строить график.",
  },
} as const;

export type TranslationKey = keyof typeof translations.en;

type I18nContextValue = {
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => Promise<void>;
  t: (key: TranslationKey) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>("en");

  useEffect(() => {
    storage.getItem(LANGUAGE_KEY).then((saved) => {
      if (saved === "en" || saved === "lt" || saved === "ru") {
        setLanguageState(saved);
      }
    });
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      setLanguage: async (nextLanguage) => {
        setLanguageState(nextLanguage);
        await storage.setItem(LANGUAGE_KEY, nextLanguage);
      },
      t: (key) => translations[language][key] ?? translations.en[key],
    }),
    [language],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used inside I18nProvider");
  }
  return context;
}

const storage = {
  async getItem(key: string) {
    if (Platform.OS === "web") {
      return globalThis.localStorage?.getItem(key) ?? null;
    }

    return SecureStore.getItemAsync(key);
  },
  async setItem(key: string, value: string) {
    if (Platform.OS === "web") {
      globalThis.localStorage?.setItem(key, value);
      return;
    }

    await SecureStore.setItemAsync(key, value);
  },
};
