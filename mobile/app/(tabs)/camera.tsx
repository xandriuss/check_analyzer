import { CameraView, useCameraPermissions } from "expo-camera";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  LayoutChangeEvent,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { completeRewardedAd, getUsage, Receipt, uploadReceipt, UsageStatus } from "@/lib/api";
import { useAuth } from "@/context/auth";

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export default function CameraScreen() {
  const { token, user } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [result, setResult] = useState<Receipt | null>(null);
  const [usage, setUsage] = useState<UsageStatus | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [adPlaying, setAdPlaying] = useState(false);
  const [adSecondsLeft, setAdSecondsLeft] = useState(8);
  const [cameraLayout, setCameraLayout] = useState<Rect | null>(null);
  const [frameLayout, setFrameLayout] = useState<Rect | null>(null);

  const loadUsage = useCallback(async () => {
    if (!token) return;
    try {
      setUsage(await getUsage(token));
    } catch {
      setUsage(null);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      loadUsage();
    }, [loadUsage]),
  );

  useEffect(() => {
    if (!adPlaying || !token) return;

    if (adSecondsLeft <= 0) {
      completeRewardedAd(token)
        .then(setUsage)
        .finally(() => {
          setAdPlaying(false);
          setAdSecondsLeft(8);
        });
      return;
    }

    const timer = setTimeout(() => setAdSecondsLeft((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [adPlaying, adSecondsLeft, token]);

  const takePhoto = async () => {
    setError("");
    const picture = await cameraRef.current?.takePictureAsync({
      exif: true,
      quality: 0.85,
      skipProcessing: false,
    });
    if (picture?.uri) {
      try {
        const cropped = await cropReceiptPhoto(
          picture.uri,
          picture.width,
          picture.height,
          frameLayout,
          cameraLayout,
        );
        setPhotoUri(cropped);
      } catch {
        setPhotoUri(picture.uri);
      }
      setResult(null);
    }
  };

  const upload = async () => {
    if (!photoUri || !token) return;

    setLoading(true);
    setError("");

    try {
      const scan = await uploadReceipt(photoUri, token);
      setResult(scan);
      setPhotoUri(null);
      await loadUsage();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not scan receipt");
    } finally {
      setLoading(false);
    }
  };

  if (!permission?.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permissionTitle}>Camera access is needed</Text>
        <Text style={styles.permissionText}>The receipt has to be photographed before AI can scan it.</Text>
        <Pressable onPress={requestPermission} style={styles.primary}>
          <Text style={styles.primaryText}>Allow camera</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {!photoUri ? (
        <CameraView ref={cameraRef} style={styles.camera}>
          <View onLayout={(event) => setCameraLayout(layoutToRect(event))} style={styles.cameraShade}>
            <View onLayout={(event) => setFrameLayout(layoutToRect(event))} style={styles.receiptFrame}>
              <View style={styles.centerLine} />
              <View style={[styles.corner, styles.cornerTopLeft]} />
              <View style={[styles.corner, styles.cornerTopRight]} />
              <View style={[styles.corner, styles.cornerBottomLeft]} />
              <View style={[styles.corner, styles.cornerBottomRight]} />
            </View>
            <Text style={styles.frameText}>Fill the tall guide with the receipt</Text>

            {result && (
              <View style={styles.totalPanel}>
                <View>
                  <Text style={styles.labelLight}>Total spent</Text>
                  <Text style={styles.totalLight}>{result.total.toFixed(2)} EUR</Text>
                </View>
                <View>
                  <Text style={styles.labelLight}>Wasted on junk</Text>
                  <Text style={styles.junkLight}>{result.junk_total.toFixed(2)} EUR</Text>
                </View>
              </View>
            )}

            {!user?.is_subscriber && (
              <RewardedScanBox adPlaying={adPlaying} onWatch={() => setAdPlaying(true)} usage={usage} />
            )}

            <Pressable onPress={takePhoto} style={styles.shutter} />
          </View>
        </CameraView>
      ) : (
        <View style={styles.previewScreen}>
          <Image source={{ uri: photoUri }} style={styles.preview} />
          <View style={styles.actions}>
            <Pressable
              onPress={() => {
                setPhotoUri(null);
                setResult(null);
                setError("");
              }}
              style={styles.secondary}
            >
              <Text style={styles.secondaryText}>Retake</Text>
            </Pressable>
            <Pressable disabled={loading} onPress={upload} style={styles.primary}>
              {loading ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryText}>Scan</Text>}
            </Pressable>
          </View>

          {!!error && <Text style={styles.error}>{error}</Text>}

          {result && (
            <View style={styles.result}>
              <View>
                <Text style={styles.label}>Total spent</Text>
                <Text style={styles.total}>{result.total.toFixed(2)} EUR</Text>
              </View>
              <View>
                <Text style={styles.label}>Wasted on junk</Text>
                <Text style={styles.junk}>{result.junk_total.toFixed(2)} EUR</Text>
              </View>
            </View>
          )}
        </View>
      )}

      <Modal animationType="fade" transparent visible={adPlaying}>
        <View style={styles.adModalBackdrop}>
          <View style={styles.adModal}>
            <Text style={styles.adModalEyebrow}>Rewarded ad</Text>
            <Text style={styles.adModalTitle}>Watch to unlock 1 scan</Text>
            <Text style={styles.adModalText}>
              Keep this open until the timer ends. One full ad gives one bonus scan.
            </Text>
            <View style={styles.fakeAd}>
              <Text style={styles.fakeAdText}>Ad preview</Text>
            </View>
            <Text style={styles.adTimer}>{adSecondsLeft}s</Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function RewardedScanBox({
  adPlaying,
  onWatch,
  usage,
}: {
  adPlaying: boolean;
  onWatch: () => void;
  usage: UsageStatus | null;
}) {
  if (!usage || usage.is_subscriber) return null;

  const weeklyRemaining = usage.weekly_remaining ?? 0;
  const canWatchRewardAd = weeklyRemaining <= 0;

  if (canWatchRewardAd && usage.rewarded_ads_remaining <= 0) {
    return (
      <View style={styles.rewardBox}>
        <Text style={styles.rewardText}>
          Free scans left: {weeklyRemaining}. Bonus credits: {usage.bonus_scan_credits}
        </Text>
        <Text style={styles.rewardText}>
          Daily rewarded scans used. They reset 24h after the first rewarded scan.
        </Text>
        {usage.rewarded_ads_reset_at ? (
          <Text style={styles.rewardSubText}>Reset: {formatResetTime(usage.rewarded_ads_reset_at)}</Text>
        ) : null}
      </View>
    );
  }

  const buttonCount = `${usage.rewarded_ads_remaining}/${usage.rewarded_ads_limit || 3}`;
  return (
    <View style={styles.rewardBox}>
      <Text style={styles.rewardText}>
        Free scans left: {weeklyRemaining}. Bonus credits: {usage.bonus_scan_credits}
      </Text>
      {usage.rewarded_ads_reset_at ? (
        <Text style={styles.rewardSubText}>Reward reset: {formatResetTime(usage.rewarded_ads_reset_at)}</Text>
      ) : null}
      {canWatchRewardAd ? (
        <Pressable disabled={adPlaying} onPress={onWatch} style={[styles.rewardButton, adPlaying && styles.disabled]}>
          <Text style={styles.rewardButtonText}>Get free scan {buttonCount}</Text>
        </Pressable>
      ) : (
        <Text style={styles.rewardSubText}>Rewarded scans unlock when free scans reach 0.</Text>
      )}
    </View>
  );
}

function formatResetTime(value: string) {
  const reset = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`);
  if (Number.isNaN(reset.getTime())) {
    return "soon";
  }

  const minutes = Math.max(Math.ceil((reset.getTime() - Date.now()) / 60000), 0);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  if (hours <= 0) {
    return `in ${remainder} min`;
  }

  return `in ${hours}h ${remainder}m`;
}

async function cropReceiptPhoto(
  uri: string,
  width?: number,
  height?: number,
  frame?: Rect | null,
  view?: Rect | null,
) {
  const normalized = await manipulateAsync(uri, [], {
    compress: 0.94,
    format: SaveFormat.JPEG,
  });
  const imageWidth = normalized.width || width;
  const imageHeight = normalized.height || height;

  if (!imageWidth || !imageHeight) {
    return uri;
  }

  const crop = frame && view
    ? cropFromVisibleFrame(frame, view, imageWidth, imageHeight)
    : centeredReceiptCrop(imageWidth, imageHeight);

  const result = await manipulateAsync(
    normalized.uri,
    [
      {
        crop,
      },
    ],
    { compress: 0.92, format: SaveFormat.JPEG },
  );

  return result.uri;
}

function layoutToRect(event: LayoutChangeEvent) {
  const { x, y, width, height } = event.nativeEvent.layout;
  return { x, y, width, height };
}

function cropFromVisibleFrame(frame: Rect, view: Rect, imageWidth: number, imageHeight: number) {
  const scale = Math.max(view.width / imageWidth, view.height / imageHeight);
  const displayedWidth = imageWidth * scale;
  const displayedHeight = imageHeight * scale;
  const hiddenX = Math.max((displayedWidth - view.width) / 2, 0);
  const hiddenY = Math.max((displayedHeight - view.height) / 2, 0);
  const padding = Math.min(frame.width, frame.height) * 0.035;

  const imageX = (frame.x - padding + hiddenX) / scale;
  const imageY = (frame.y - padding + hiddenY) / scale;
  const cropWidth = (frame.width + padding * 2) / scale;
  const cropHeight = (frame.height + padding * 2) / scale;

  return clampCrop(imageX, imageY, cropWidth, cropHeight, imageWidth, imageHeight);
}

function centeredReceiptCrop(imageWidth: number, imageHeight: number) {
  const isLandscape = imageWidth > imageHeight;
  const cropWidth = isLandscape ? imageWidth * 0.5 : imageWidth * 0.72;
  const cropHeight = isLandscape ? imageHeight * 0.9 : imageHeight * 0.84;
  return clampCrop((imageWidth - cropWidth) / 2, imageHeight * 0.05, cropWidth, cropHeight, imageWidth, imageHeight);
}

function clampCrop(
  x: number,
  y: number,
  requestedWidth: number,
  requestedHeight: number,
  imageWidth: number,
  imageHeight: number,
) {
  const originX = Math.max(0, Math.min(Math.round(x), imageWidth - 2));
  const originY = Math.max(0, Math.min(Math.round(y), imageHeight - 2));
  const maxWidth = imageWidth - originX;
  const maxHeight = imageHeight - originY;

  return {
    originX,
    originY,
    width: Math.max(1, Math.min(Math.floor(requestedWidth), maxWidth)),
    height: Math.max(1, Math.min(Math.floor(requestedHeight), maxHeight)),
  };
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#101718",
  },
  camera: {
    flex: 1,
  },
  cameraShade: {
    flex: 1,
    justifyContent: "space-evenly",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 42,
    paddingTop: 58,
    backgroundColor: "rgba(0,0,0,0.18)",
  },
  receiptFrame: {
    width: "72%",
    maxWidth: 300,
    aspectRatio: 0.5,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.55)",
    backgroundColor: "rgba(0,0,0,0.08)",
  },
  centerLine: {
    width: 1,
    height: "88%",
    backgroundColor: "rgba(255,255,255,0.34)",
  },
  corner: {
    position: "absolute",
    width: 42,
    height: 42,
    borderColor: "#ffffff",
  },
  cornerTopLeft: {
    top: -1,
    left: -1,
    borderTopWidth: 4,
    borderLeftWidth: 4,
  },
  cornerTopRight: {
    top: -1,
    right: -1,
    borderTopWidth: 4,
    borderRightWidth: 4,
  },
  cornerBottomLeft: {
    bottom: -1,
    left: -1,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
  },
  cornerBottomRight: {
    right: -1,
    bottom: -1,
    borderRightWidth: 4,
    borderBottomWidth: 4,
  },
  frameText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
    textAlign: "center",
  },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 7,
    borderColor: "#ffffff",
    backgroundColor: "#e45b2c",
  },
  totalPanel: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    width: "100%",
    borderRadius: 8,
    padding: 14,
    backgroundColor: "rgba(255,255,255,0.92)",
  },
  labelLight: {
    color: "#657174",
    fontSize: 13,
    fontWeight: "700",
  },
  totalLight: {
    color: "#183f45",
    fontSize: 24,
    fontWeight: "900",
  },
  junkLight: {
    color: "#b3261e",
    fontSize: 24,
    fontWeight: "900",
  },
  rewardBox: {
    width: "100%",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
    padding: 10,
    backgroundColor: "rgba(0,0,0,0.26)",
  },
  rewardText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  rewardSubText: {
    marginTop: 4,
    color: "rgba(255,255,255,0.78)",
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
  },
  rewardButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 42,
    marginTop: 8,
    borderRadius: 8,
    backgroundColor: "#ffffff",
  },
  rewardButtonText: {
    color: "#183f45",
    fontWeight: "900",
  },
  disabled: {
    opacity: 0.55,
  },
  previewScreen: {
    flex: 1,
    backgroundColor: "#f6f4ef",
  },
  preview: {
    flex: 1,
    resizeMode: "contain",
    backgroundColor: "#111111",
  },
  actions: {
    flexDirection: "row",
    gap: 12,
    padding: 16,
    backgroundColor: "#f6f4ef",
  },
  primary: {
    flex: 1,
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "#e45b2c",
  },
  primaryText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "800",
  },
  secondary: {
    flex: 1,
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#c9c2b5",
    backgroundColor: "#ffffff",
  },
  secondaryText: {
    color: "#183f45",
    fontSize: 16,
    fontWeight: "800",
  },
  result: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    padding: 18,
    backgroundColor: "#ffffff",
    borderTopWidth: 1,
    borderColor: "#e6e1d7",
  },
  label: {
    color: "#657174",
    fontSize: 13,
    fontWeight: "700",
  },
  total: {
    color: "#183f45",
    fontSize: 26,
    fontWeight: "900",
  },
  junk: {
    color: "#b3261e",
    fontSize: 26,
    fontWeight: "900",
  },
  error: {
    paddingHorizontal: 18,
    paddingBottom: 10,
    color: "#b3261e",
    fontWeight: "700",
  },
  center: {
    flex: 1,
    justifyContent: "center",
    gap: 12,
    padding: 24,
    backgroundColor: "#f6f4ef",
  },
  permissionTitle: {
    color: "#1b2a2f",
    fontSize: 24,
    fontWeight: "900",
  },
  permissionText: {
    color: "#5f6d70",
    fontSize: 16,
    lineHeight: 22,
  },
  adModalBackdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "rgba(0,0,0,0.72)",
  },
  adModal: {
    width: "100%",
    gap: 12,
    borderRadius: 8,
    padding: 18,
    backgroundColor: "#ffffff",
  },
  adModalEyebrow: {
    color: "#e45b2c",
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  adModalTitle: {
    color: "#1b2a2f",
    fontSize: 24,
    fontWeight: "900",
  },
  adModalText: {
    color: "#657174",
    lineHeight: 20,
  },
  fakeAd: {
    height: 160,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "#182326",
  },
  fakeAdText: {
    color: "#ffffff",
    fontWeight: "900",
  },
  adTimer: {
    color: "#183f45",
    fontSize: 22,
    fontWeight: "900",
    textAlign: "center",
  },
});
