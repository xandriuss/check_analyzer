import { CameraView, useCameraPermissions } from "expo-camera";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { manipulateAsync, SaveFormat, type Action } from "expo-image-manipulator";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  LayoutChangeEvent,
  Modal,
  PanResponder,
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

type CapturedPhoto = {
  uri: string;
  width?: number;
  height?: number;
  exif?: Record<string, any>;
};

const CAMERA_PHOTO_QUALITY = 0.88;
const PREVIEW_JPEG_QUALITY = 0.9;
const SCAN_JPEG_QUALITY = 0.78;
const SCAN_MAX_LONG_EDGE = 1700;

export default function CameraScreen() {
  const { token, user } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [result, setResult] = useState<Receipt | null>(null);
  const [usage, setUsage] = useState<UsageStatus | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [adPlaying, setAdPlaying] = useState(false);
  const [adSecondsLeft, setAdSecondsLeft] = useState(8);
  const [previewLayout, setPreviewLayout] = useState<Rect | null>(null);
  const [cropRect, setCropRect] = useState<Rect | null>(null);
  const dragStart = useRef<Rect | null>(null);
  const cropRectRef = useRef<Rect | null>(null);
  const cropBoundsRef = useRef<Rect | null>(null);

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

  useEffect(() => {
    if (!photo || !previewLayout || cropRect) return;
    setCropRect(defaultCropRect(previewLayout, photo.width, photo.height));
  }, [cropRect, photo, previewLayout]);

  const cropBounds = photo && previewLayout ? containedImageRect(previewLayout, photo.width, photo.height) : null;

  useEffect(() => {
    cropRectRef.current = cropRect;
    cropBoundsRef.current = cropBounds;
  }, [cropBounds, cropRect]);

  const dragResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      dragStart.current = cropRectRef.current;
    },
    onPanResponderMove: (_, gesture) => {
      const bounds = cropBoundsRef.current;
      if (!dragStart.current || !bounds) return;
      setCropRect(
        clampRect(
          {
            ...dragStart.current,
            x: dragStart.current.x + gesture.dx,
            y: dragStart.current.y + gesture.dy,
          },
          bounds,
        ),
      );
    },
  })).current;

  const resizeResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      dragStart.current = cropRectRef.current;
    },
    onPanResponderMove: (_, gesture) => {
      const bounds = cropBoundsRef.current;
      if (!dragStart.current || !bounds) return;
      setCropRect(
        clampResizeRect(
          {
            ...dragStart.current,
            width: dragStart.current.width + gesture.dx,
            height: dragStart.current.height + gesture.dy,
          },
          bounds,
        ),
      );
    },
  })).current;
  const cornerResponders = useRef({
    topLeft: PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        dragStart.current = cropRectRef.current;
      },
      onPanResponderMove: (_, gesture) => {
        const bounds = cropBoundsRef.current;
        if (!dragStart.current || !bounds) return;
        setCropRect(resizeFromCorner(dragStart.current, bounds, "topLeft", gesture.dx, gesture.dy));
      },
    }),
    topRight: PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        dragStart.current = cropRectRef.current;
      },
      onPanResponderMove: (_, gesture) => {
        const bounds = cropBoundsRef.current;
        if (!dragStart.current || !bounds) return;
        setCropRect(resizeFromCorner(dragStart.current, bounds, "topRight", gesture.dx, gesture.dy));
      },
    }),
    bottomLeft: PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        dragStart.current = cropRectRef.current;
      },
      onPanResponderMove: (_, gesture) => {
        const bounds = cropBoundsRef.current;
        if (!dragStart.current || !bounds) return;
        setCropRect(resizeFromCorner(dragStart.current, bounds, "bottomLeft", gesture.dx, gesture.dy));
      },
    }),
    bottomRight: resizeResponder,
  }).current;

  const takePhoto = async () => {
    setError("");
    try {
      const picture = await cameraRef.current?.takePictureAsync({
        exif: false,
        quality: CAMERA_PHOTO_QUALITY,
        skipProcessing: false,
      });
      if (picture?.uri) {
        const normalized = await normalizeCapturedPhoto({
          uri: picture.uri,
          width: picture.width,
          height: picture.height,
          exif: picture.exif,
        });
        setPhoto(normalized);
        setCropRect(null);
        setResult(null);
        setTorchOn(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not take photo");
    }
  };

  const rotatePhoto = async () => {
    if (!photo || loading) return;

    setError("");
    try {
      const rotated = await rotateCropPreviewPhoto(photo);
      setPhoto(rotated);
      setCropRect(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rotate photo");
    }
  };

  const upload = async () => {
    if (!photo || !token) return;

    setLoading(true);
    setError("");

    try {
      const croppedUri = await cropReceiptPhoto(photo, cropRect, previewLayout);
      const scan = await uploadReceipt(croppedUri, token);
      setResult(scan);
      setPhoto(null);
      setCropRect(null);
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
      {!photo ? (
        <CameraView
          ref={cameraRef}
          enableTorch={torchOn}
          responsiveOrientationWhenOrientationLocked={false}
          style={styles.camera}
        >
          <View style={styles.cameraShade}>
            <Pressable
              accessibilityLabel={torchOn ? "Turn flashlight off" : "Turn flashlight on"}
              onPress={() => setTorchOn((value) => !value)}
              style={[styles.torchButton, torchOn && styles.torchButtonActive]}
            >
              <MaterialIcons color={torchOn ? "#183f45" : "#ffffff"} name={torchOn ? "flash-on" : "flash-off"} size={24} />
            </Pressable>

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
          <View onLayout={(event) => setPreviewLayout(layoutToRect(event))} style={styles.previewWrap}>
            <Image source={{ uri: photo.uri }} style={styles.preview} />
            {cropRect && (
              <View
                pointerEvents="box-none"
                style={[
                  styles.cropBox,
                  {
                    left: cropRect.x,
                    top: cropRect.y,
                    width: cropRect.width,
                    height: cropRect.height,
                  },
                ]}
              >
                <View {...cornerResponders.topLeft.panHandlers} style={[styles.cornerHandle, styles.cornerHandleTopLeft]}>
                  <View style={[styles.cropCorner, styles.cropCornerTopLeft]} />
                </View>
                <View {...cornerResponders.topRight.panHandlers} style={[styles.cornerHandle, styles.cornerHandleTopRight]}>
                  <View style={[styles.cropCorner, styles.cropCornerTopRight]} />
                </View>
                <View {...cornerResponders.bottomLeft.panHandlers} style={[styles.cornerHandle, styles.cornerHandleBottomLeft]}>
                  <View style={[styles.cropCorner, styles.cropCornerBottomLeft]} />
                </View>
                <View {...dragResponder.panHandlers} style={styles.moveHandle} />
                <View {...cornerResponders.bottomRight.panHandlers} style={styles.resizeHandle}>
                  <View style={[styles.cropCorner, styles.cropCornerBottomRight]} />
                  <View style={styles.resizeKnob} />
                </View>
              </View>
            )}
            <View pointerEvents="none" style={styles.cropHint}>
              <Text style={styles.cropHintText}>Move the frame, pull the orange corner</Text>
            </View>
          </View>
          <View style={styles.actions}>
            <Pressable
              onPress={() => {
                setPhoto(null);
                setCropRect(null);
                setResult(null);
                setError("");
              }}
              style={styles.secondary}
            >
              <Text style={styles.secondaryText}>Retake</Text>
            </Pressable>
            <Pressable disabled={loading} onPress={rotatePhoto} style={styles.secondary}>
              <Text style={styles.secondaryText}>Rotate</Text>
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
  photo: CapturedPhoto,
  cropRect?: Rect | null,
  previewLayout?: Rect | null,
) {
  const normalized = await manipulateAsync(photo.uri, [], {
    compress: PREVIEW_JPEG_QUALITY,
    format: SaveFormat.JPEG,
  });
  const imageWidth = normalized.width || photo.width;
  const imageHeight = normalized.height || photo.height;

  if (!imageWidth || !imageHeight) {
    return photo.uri;
  }

  const crop = cropRect && previewLayout
    ? cropFromManualRect(cropRect, previewLayout, imageWidth, imageHeight)
    : centeredReceiptCrop(imageWidth, imageHeight);

  const actions: Action[] = [{ crop }];
  const resize = resizeActionForScan(crop.width, crop.height);
  if (resize) {
    actions.push(resize);
  }

  const result = await manipulateAsync(normalized.uri, actions, {
    compress: SCAN_JPEG_QUALITY,
    format: SaveFormat.JPEG,
  });

  return result.uri;
}

async function normalizeCapturedPhoto(photo: CapturedPhoto): Promise<CapturedPhoto> {
  const normalized = await manipulateAsync(photo.uri, [], {
    compress: PREVIEW_JPEG_QUALITY,
    format: SaveFormat.JPEG,
  });

  return {
    uri: normalized.uri,
    width: normalized.width || photo.width,
    height: normalized.height || photo.height,
  };
}

async function rotateCropPreviewPhoto(photo: CapturedPhoto): Promise<CapturedPhoto> {
  const rotated = await manipulateAsync(photo.uri, [{ rotate: 90 }], {
    compress: PREVIEW_JPEG_QUALITY,
    format: SaveFormat.JPEG,
  });

  return {
    uri: rotated.uri,
    width: rotated.width || photo.height,
    height: rotated.height || photo.width,
  };
}

function layoutToRect(event: LayoutChangeEvent) {
  const { x, y, width, height } = event.nativeEvent.layout;
  return { x, y, width, height };
}

function containedImageRect(view: Rect, imageWidth = 1, imageHeight = 1) {
  const scale = Math.min(view.width / imageWidth, view.height / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    x: (view.width - width) / 2,
    y: (view.height - height) / 2,
    width,
    height,
  };
}

function defaultCropRect(view: Rect, imageWidth = 1, imageHeight = 1) {
  const bounds = containedImageRect(view, imageWidth, imageHeight);
  const portraitReceipt = bounds.height >= bounds.width;
  const width = bounds.width * (portraitReceipt ? 0.82 : 0.58);
  const height = bounds.height * (portraitReceipt ? 0.88 : 0.82);
  return clampRect(
    {
      x: bounds.x + (bounds.width - width) / 2,
      y: bounds.y + (bounds.height - height) / 2,
      width,
      height,
    },
    bounds,
  );
}

function cropFromManualRect(crop: Rect, view: Rect, imageWidth: number, imageHeight: number) {
  const displayed = containedImageRect(view, imageWidth, imageHeight);
  const scale = displayed.width / imageWidth;
  const padding = Math.min(crop.width, crop.height) * 0.02;
  return clampCrop(
    (crop.x - displayed.x - padding) / scale,
    (crop.y - displayed.y - padding) / scale,
    (crop.width + padding * 2) / scale,
    (crop.height + padding * 2) / scale,
    imageWidth,
    imageHeight,
  );
}

function resizeActionForScan(width: number, height: number): Action | null {
  const longEdge = Math.max(width, height);
  if (longEdge <= SCAN_MAX_LONG_EDGE) {
    return null;
  }

  if (width >= height) {
    return { resize: { width: SCAN_MAX_LONG_EDGE } };
  }

  return { resize: { height: SCAN_MAX_LONG_EDGE } };
}

function clampRect(rect: Rect, bounds: Rect) {
  const minSize = Math.min(48, bounds.width * 0.24, bounds.height * 0.24);
  const width = Math.max(minSize, Math.min(rect.width, bounds.width));
  const height = Math.max(minSize, Math.min(rect.height, bounds.height));
  return {
    x: Math.max(bounds.x, Math.min(rect.x, bounds.x + bounds.width - width)),
    y: Math.max(bounds.y, Math.min(rect.y, bounds.y + bounds.height - height)),
    width,
    height,
  };
}

function clampResizeRect(rect: Rect, bounds: Rect) {
  const minSize = Math.min(48, bounds.width * 0.24, bounds.height * 0.24);
  const x = Math.max(bounds.x, Math.min(rect.x, bounds.x + bounds.width - minSize));
  const y = Math.max(bounds.y, Math.min(rect.y, bounds.y + bounds.height - minSize));
  const maxWidth = bounds.x + bounds.width - x;
  const maxHeight = bounds.y + bounds.height - y;
  return {
    x,
    y,
    width: Math.max(minSize, Math.min(rect.width, maxWidth)),
    height: Math.max(minSize, Math.min(rect.height, maxHeight)),
  };
}

function resizeFromCorner(
  rect: Rect,
  bounds: Rect,
  corner: "topLeft" | "topRight" | "bottomLeft" | "bottomRight",
  dx: number,
  dy: number,
) {
  const minSize = Math.min(48, bounds.width * 0.24, bounds.height * 0.24);
  let left = rect.x;
  let right = rect.x + rect.width;
  let top = rect.y;
  let bottom = rect.y + rect.height;

  if (corner.includes("Left")) {
    left = clamp(rect.x + dx, bounds.x, right - minSize);
  } else {
    right = clamp(rect.x + rect.width + dx, left + minSize, bounds.x + bounds.width);
  }

  if (corner.includes("top")) {
    top = clamp(rect.y + dy, bounds.y, bottom - minSize);
  } else {
    bottom = clamp(rect.y + rect.height + dy, top + minSize, bounds.y + bounds.height);
  }

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
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
    justifyContent: "flex-end",
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
  previewScreen: {
    flex: 1,
    backgroundColor: "#f6f4ef",
  },
  previewWrap: {
    flex: 1,
    backgroundColor: "#111111",
  },
  preview: {
    flex: 1,
    resizeMode: "contain",
    backgroundColor: "#111111",
  },
  cropBox: {
    position: "absolute",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.88)",
    backgroundColor: "rgba(228,91,44,0.04)",
  },
  moveHandle: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1,
    borderRadius: 8,
    backgroundColor: "transparent",
  },
  cropCorner: {
    position: "absolute",
    zIndex: 2,
    width: 24,
    height: 24,
    borderColor: "#e45b2c",
  },
  cornerHandle: {
    position: "absolute",
    zIndex: 4,
    width: 48,
    height: 48,
  },
  cornerHandleTopLeft: {
    top: -18,
    left: -18,
  },
  cornerHandleTopRight: {
    top: -18,
    right: -18,
    alignItems: "flex-end",
  },
  cornerHandleBottomLeft: {
    left: -18,
    bottom: -18,
    justifyContent: "flex-end",
  },
  cropCornerTopLeft: {
    top: -2,
    left: -2,
    borderLeftWidth: 5,
    borderTopWidth: 5,
  },
  cropCornerTopRight: {
    top: -2,
    right: -2,
    borderRightWidth: 5,
    borderTopWidth: 5,
  },
  cropCornerBottomLeft: {
    left: -2,
    bottom: -2,
    borderLeftWidth: 5,
    borderBottomWidth: 5,
  },
  cropCornerBottomRight: {
    right: -2,
    bottom: -2,
    borderRightWidth: 5,
    borderBottomWidth: 5,
  },
  resizeHandle: {
    position: "absolute",
    right: -20,
    bottom: -20,
    zIndex: 3,
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  resizeKnob: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "#ffffff",
    backgroundColor: "#e45b2c",
  },
  cropHint: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 14,
    alignItems: "center",
  },
  cropHintText: {
    overflow: "hidden",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "rgba(0,0,0,0.58)",
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
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
