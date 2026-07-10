import { View, Text, StyleSheet } from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useTheme } from '../theme/ThemeContext';
import { Button } from './Button';
import { ar } from '../copy/ar';

interface AudioPlayerProps {
  uri: string;
}

export function AudioPlayer({ uri }: AudioPlayerProps) {
  const { tokens } = useTheme();
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);

  function handlePress() {
    if (status.playing) {
      player.pause();
    } else {
      player.play();
    }
  }

  return (
    <View style={styles.row}>
      <Button title={status.playing ? ar.sampleRecording.pause : ar.sampleRecording.play} onPress={handlePress} />
      <Text style={{ color: tokens.colors.textSecondary }}>
        {`${Math.floor(status.currentTime)} ${ar.sampleRecording.secondsUnit} / ${Math.floor(status.duration)} ${ar.sampleRecording.secondsUnit}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
