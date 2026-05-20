import { Body, Button, useTheme } from '@amana/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, View } from 'react-native';
import { api } from '../lib/api';
import type { PayStackParamList } from '../nav/PayStack';

type Props = NativeStackScreenProps<PayStackParamList, 'PhotoAttach'>;

type Phase = 'camera' | 'preview' | 'uploading' | 'done' | 'error';

export function PhotoAttachScreen({ route, navigation }: Props): JSX.Element {
  const theme = useTheme();
  const { transactionId } = route.params;
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>('camera');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const cameraRef = useRef<InstanceType<typeof CameraView>>(null);

  const takePicture = async () => {
    if (!cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7 });
      if (photo) {
        setPhotoUri(photo.uri);
        setPhase('preview');
      }
    } catch {
      Alert.alert('Error', 'Could not capture photo.');
    }
  };

  const upload = async () => {
    if (!photoUri) return;
    setPhase('uploading');
    try {
      const { uploadUrl, key } = await api.media.getUploadUrl(transactionId, 'image/jpeg');

      // PUT directly to S3 — no backend proxy
      const blob = await (await fetch(photoUri)).blob();
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: blob,
      });
      if (!putRes.ok) throw new Error(`S3 upload failed: ${putRes.status}`);

      await api.media.attachMedia(transactionId, key);
      setPhase('done');
      setTimeout(() => navigation.goBack(), 1200);
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Upload failed.');
      setPhase('error');
    }
  };

  if (!permission) return <ActivityIndicator style={{ flex: 1 }} />;

  // Permission denied — themed non-camera UI
  if (!permission.granted) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          gap: 16,
          backgroundColor: theme.colors.bg.base,
        }}
      >
        <Body muted style={{ textAlign: 'center' }}>
          Camera access is needed to attach a photo.
        </Body>
        <Button
          label="GRANT CAMERA PERMISSION"
          onPress={() => void requestPermission()}
          fullWidth={false}
        />
      </View>
    );
  }

  if (phase === 'camera') {
    return (
      <View style={{ flex: 1 }}>
        <CameraView ref={cameraRef} style={{ flex: 1 }} />
        <View style={styles.captureBar}>
          <Pressable style={styles.captureBtn} onPress={() => void takePicture()}>
            <View style={styles.captureInner} />
          </Pressable>
        </View>
      </View>
    );
  }

  if (phase === 'preview' && photoUri) {
    return (
      <View style={{ flex: 1 }}>
        <Image source={{ uri: photoUri }} style={{ flex: 1 }} resizeMode="cover" />
        <View style={styles.previewBar}>
          <Button
            variant="secondary"
            label="RETAKE"
            onPress={() => {
              setPhotoUri(null);
              setPhase('camera');
            }}
            fullWidth={false}
            style={{ flex: 1 }}
          />
          <Button
            label="USE PHOTO"
            onPress={() => void upload()}
            fullWidth={false}
            style={{ flex: 1 }}
          />
        </View>
      </View>
    );
  }

  if (phase === 'uploading') {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          backgroundColor: theme.colors.bg.base,
        }}
      >
        <ActivityIndicator size="large" />
        <Body muted>Uploading photo…</Body>
      </View>
    );
  }

  if (phase === 'done') {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          backgroundColor: theme.colors.bg.base,
        }}
      >
        <Body style={{ color: theme.colors.credit, fontSize: 64 }}>✓</Body>
        <Body muted>Photo attached!</Body>
      </View>
    );
  }

  // phase === 'error'
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: 24,
        backgroundColor: theme.colors.bg.base,
      }}
    >
      <Body style={{ color: theme.colors.debit, textAlign: 'center' }}>{errorMsg}</Body>
      <Button label="TRY AGAIN" onPress={() => setPhase('camera')} fullWidth={false} />
    </View>
  );
}

const styles = StyleSheet.create({
  captureBar: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  captureBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: 'white',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'white' },
  previewBar: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 32,
    gap: 12,
  },
});
