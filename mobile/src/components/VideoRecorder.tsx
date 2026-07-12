import { useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useTheme } from '../theme/ThemeContext';
import { Button } from './Button';
import { ar } from '../copy/ar';

const MAX_DURATION_SECONDS = 3 * 60;

interface VideoRecorderProps {
  onRecorded: (uri: string, durationSeconds: number) => void;
  disabled?: boolean;
}

export function VideoRecorder({ onRecorded, disabled }: VideoRecorderProps) {
  const { tokens } = useTheme();
  const cameraRef = useRef<CameraView>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [microphonePermission, requestMicrophonePermission] = useMicrophonePermissions();
  const [permissionsGranted, setPermissionsGranted] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  // Tracks whether a native recordAsync() call is actually in flight. This is
  // deliberately separate from `isRecording` (which flips immediately on user
  // input for responsive UI / test-timing reasons) so a rapid stop-then-start
  // re-press can't fire a second recordAsync() while the first is still
  // finishing on the native side.
  const isNativeRecordingActiveRef = useRef(false);

  async function handleEnableCamera() {
    const cam = cameraPermission?.granted ? cameraPermission : await requestCameraPermission();
    const mic = microphonePermission?.granted ? microphonePermission : await requestMicrophonePermission();
    if (!cam.granted || !mic.granted) {
      setPermissionDenied(true);
      return;
    }
    setPermissionDenied(false);
    setPermissionsGranted(true);
  }

  async function handleStartStop() {
    if (isRecording) {
      // Flip the UI immediately on user-initiated stop rather than waiting for
      // recordAsync's promise to settle: recordAsync only resolves once the
      // recording has actually finished, so gating the "isRecording" flag on
      // that resolution here would leave the stop button unresponsive until
      // then.
      setIsRecording(false);
      cameraRef.current?.stopRecording();
      return;
    }
    if (!cameraRef.current) return;
    if (isNativeRecordingActiveRef.current) return;
    isNativeRecordingActiveRef.current = true;
    setIsRecording(true);
    const startedAt = Date.now();
    try {
      const result = await cameraRef.current.recordAsync({ maxDuration: MAX_DURATION_SECONDS });
      if (result?.uri) {
        const durationSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
        onRecorded(result.uri, durationSeconds);
      }
    } catch (error) {
      setIsRecording(false);
    } finally {
      isNativeRecordingActiveRef.current = false;
    }
  }

  return (
    <View>
      {permissionDenied ? (
        <Text style={{ color: tokens.colors.danger, marginBottom: 8 }}>{ar.sampleRecording.cameraPermissionDenied}</Text>
      ) : null}
      {!permissionsGranted ? (
        <Button title={ar.sampleRecording.enableCamera} onPress={handleEnableCamera} disabled={disabled} />
      ) : (
        <View>
          <CameraView ref={cameraRef} style={styles.camera} mode="video" facing="front" videoQuality="720p" />
          <Button
            title={isRecording ? ar.sampleRecording.stopRecording : ar.sampleRecording.record}
            onPress={handleStartStop}
            disabled={disabled}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  camera: { width: '100%', aspectRatio: 3 / 4, marginBottom: 8 },
});
