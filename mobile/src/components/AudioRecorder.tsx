import { useEffect, useRef, useState } from 'react';
import { View, Text } from 'react-native';
import {
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
  requestRecordingPermissionsAsync,
} from 'expo-audio';
import { useTheme } from '../theme/ThemeContext';
import { Button } from './Button';
import { ar } from '../copy/ar';

const MAX_DURATION_MILLIS = 3 * 60 * 1000;

interface AudioRecorderProps {
  onRecorded: (uri: string) => void;
  disabled?: boolean;
}

export function AudioRecorder({ onRecorded, disabled }: AudioRecorderProps) {
  const { tokens } = useTheme();
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const autoStopTriggered = useRef(false);

  useEffect(() => {
    if (recorderState.isRecording && recorderState.durationMillis >= MAX_DURATION_MILLIS && !autoStopTriggered.current) {
      autoStopTriggered.current = true;
      stopAndReport();
    }
    if (!recorderState.isRecording) {
      autoStopTriggered.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorderState.isRecording, recorderState.durationMillis]);

  async function stopAndReport() {
    await audioRecorder.stop();
    if (audioRecorder.uri) {
      onRecorded(audioRecorder.uri);
    }
  }

  async function handlePress() {
    if (recorderState.isRecording) {
      await stopAndReport();
      return;
    }
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setPermissionDenied(true);
      return;
    }
    setPermissionDenied(false);
    await audioRecorder.prepareToRecordAsync();
    audioRecorder.record();
  }

  const seconds = Math.floor(recorderState.durationMillis / 1000);
  const hitMaxDuration = recorderState.isRecording && recorderState.durationMillis >= MAX_DURATION_MILLIS;

  return (
    <View>
      {permissionDenied ? (
        <Text style={{ color: tokens.colors.danger, marginBottom: 8 }}>{ar.sampleRecording.micPermissionDenied}</Text>
      ) : null}
      {hitMaxDuration ? (
        <Text style={{ color: tokens.colors.textSecondary, marginBottom: 8 }}>{ar.sampleRecording.maxDurationReached}</Text>
      ) : recorderState.isRecording ? (
        <Text style={{ color: tokens.colors.text, marginBottom: 8 }}>{`${seconds} ${ar.sampleRecording.secondsUnit}`}</Text>
      ) : null}
      <Button
        title={recorderState.isRecording ? ar.sampleRecording.stopRecording : ar.sampleRecording.record}
        onPress={handlePress}
        disabled={disabled}
      />
    </View>
  );
}
