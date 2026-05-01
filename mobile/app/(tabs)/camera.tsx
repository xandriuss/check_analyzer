import { CameraView, useCameraPermissions } from "expo-camera";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { manipulateAsync, SaveFormat, type Action } from "expo-image-manipulator";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { completeRewardedAd, getUsage, Receipt, uploadReceipt, UsageStatus } from "@/lib/api";
import { useAuth } from "@/context/auth";

type CapturedPhoto = {
  uri: string;
  width?: number;
  height?: number;
  exif?: Record<string, any>;
};

const CAMERA_PHOTO_QUALITY = 0.88;
const SCAN_JPEG_QUALITY = 0.78;
const SCAN_MAX_LONG_EDGE = 1700;

export default function CameraScreen() {
  const { token, user } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [result, setResult] = useState<Receipt | null>(null);
  const [usage, setUsage] = useState<UsageStatus | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [adPlaying, setAdPlaying] = useState(false);
  const [adSecondsLeft, setAdSecondsLeft] = useState(8);

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
    if (!token || loading) return;

    setError("");
    setLoading(true);

    try {
      const picture = await cameraRef.current?.takePictureAsync({
        exif: false,
        quality: CAMERA_PHOTO_QUALITY,
        skipProcessing: false,
      });
      if (picture?.uri) {
        const uploadUri = await preparePhotoForAutoScan({
          uri: picture.uri,
          width: picture.width,
          height: picture.height,
          exif: picture.exif,
        });
        const scan = await uploadReceipt(uploadUri, token);
        setResult(scan);
        await loadUsage();
        setTorchOn(false);
      }
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
      <CameraView
        ref={cameraRef}
        enableTorch={torchOn}
        responsiveOrientationWhenOrientationLocked={false}
        style={styles.camera}
      >
        <View style={styles.cameraShade}>
          <Pressable
            accessibilityLabel={torchOn ? "Turn flashlight off" : "Turn flashlight on"}
            disabled={loading}
            onPress={() => setTorchOn((value) => !value)}
            style={[styles.torchButton, torchOn && styles.torchButtonActive, loading && styles.disabled]}
          >
            <MaterialIcons color={torchOn ? "#183f45" : "#ffffff"} name={torchOn ? "flash-on" : "flash-off"} size={24} />
          </Pressable>

          {loading && (
            <View style={styles.scanOverlay}>
              <ActivityIndicator color="#ffffff" />
              <Text style={styles.scanOverlayText}>Scanning receipt...</Text>
            </View>
          )}

          {result && !loading && (
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

          {!user?.is_subscriber && !loading && (
            <RewardedScanBox adPlaying={adPlaying} onWatch={() => setAdPlaying(true)} usage={usage} />
          )}

          {!!error && <Text style={styles.cameraError}>{error}</Text>}

          <Pressable
            disabled={loading || adPlaying}
            onPress={takePhoto}
            style={[styles.shutter, (loading || adPlaying) && styles.shutterDisabled]}
          />
        </View>
      </CameraView>

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

async function preparePhotoForAutoScan(photo: CapturedPhoto) {
  const actions: Action[] = [];
  const resize = resizeActionForScan(photo.width, photo.height);
  if (resize) {
    actions.push(resize);
  }

  const result = await manipulateAsync(photo.uri, actions, {
    compress: SCAN_JPEG_QUALITY,
    format: SaveFormat.JPEG,
  });

  return result.uri;
}

function resizeActionForScan(width?: number, height?: number): Action | null {
  if (!width || !height) {
    return null;
  }

  const longEdge = Math.max(width, height);
  if (longEdge <= SCAN_MAX_LONG_EDGE) {
    return null;
  }

  if (width >= height) {
    return { resize: { width: SCAN_MAX_LONG_EDGE } };
  }

  return { resize: { height: SCAN_MAX_LONG_EDGE } };
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
    justifyContent: "flex-end",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 42,
    paddingTop: 58,
    backgroundColor: "rgba(0,0,0,0.18)",
  },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 7,
    borderColor: "#ffffff",
    backgroundColor: "#e45b2c",
  },
  shutterDisabled: {
    opacity: 0.5,
  },
  scanOverlay: {
    position: "absolute",
    top: "43%",
    alignItems: "center",
    gap: 10,
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 14,
    backgroundColor: "rgba(0,0,0,0.58)",
  },
  scanOverlayText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "900",
  },
  cameraError: {
    width: "100%",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "rgba(255,255,255,0.94)",
    color: "#b3261e",
    fontWeight: "800",
    textAlign: "center",
  },
  torchButton: {
    position: "absolute",
    top: 52,
    right: 20,
    zIndex: 5,
    width: 46,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 23,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.38)",
    backgroundColor: "rgba(0,0,0,0.42)",
  },
  torchButtonActive: {
    borderColor: "#ffffff",
    backgroundColor: "rgba(255,255,255,0.92)",
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
