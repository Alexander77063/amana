import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { api } from '../lib/api';
import type { PayStackParamList } from '../nav/PayStack';

type Props = NativeStackScreenProps<PayStackParamList, 'PhotoAttach'>;

type Phase = 'camera' | 'preview' | 'uploading' | 'done' | 'error';

export function PhotoAttachScreen({ route, navigation }: Props): JSX.Element {
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

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.sub}>Camera access is needed to attach a photo.</Text>
        <Pressable style={styles.btn} onPress={() => void requestPermission()}>
          <Text style={styles.btnText}>Allow camera</Text>
        </Pressable>
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
          <Pressable style={styles.retakeBtn} onPress={() => { setPhotoUri(null); setPhase('camera'); }}>
            <Text style={styles.retakeText}>Retake</Text>
          </Pressable>
          <Pressable style={styles.useBtn} onPress={() => void upload()}>
            <Text style={styles.useText}>Use photo</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (phase === 'uploading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
        <Text style={styles.sub}>Uploading photo…</Text>
      </View>
    );
  }

  if (phase === 'done') {
    return (
      <View style={styles.center}>
        <Text style={styles.successIcon}>✓</Text>
        <Text style={styles.sub}>Photo attached!</Text>
      </View>
    );
  }

  // phase === 'error'
  return (
    <View style={styles.center}>
      <Text style={styles.err}>{errorMsg}</Text>
      <Pressable style={styles.btn} onPress={() => setPhase('camera')}>
        <Text style={styles.btnText}>Try again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  sub: { color: '#666', textAlign: 'center' },
  err: { color: '#b00020', textAlign: 'center' },
  successIcon: { fontSize: 64, color: '#2e7d32' },
  btn: { backgroundColor: '#1a1a2e', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 999 },
  btnText: { color: 'white', fontWeight: '600' },
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
  },
  retakeBtn: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 999,
  },
  retakeText: { color: 'white', fontWeight: '600' },
  useBtn: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    backgroundColor: '#1a1a2e',
    borderRadius: 999,
  },
  useText: { color: 'white', fontWeight: '600' },
});
