import { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEvent } from 'expo';
import { Button } from './Button';
import { ar } from '../copy/ar';
import { getToken } from '../storage/session';
import { API_BASE_URL } from '../api/client';

interface VideoPlayerProps {
  path: string;
}

export function VideoPlayer({ path }: VideoPlayerProps) {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getToken().then((t) => {
      if (!cancelled) {
        setToken(t);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const source = token ? { uri: `${API_BASE_URL}${path}`, headers: { Authorization: `Bearer ${token}` } } : null;
  const player = useVideoPlayer(source, (p) => {
    if (p) {
      p.loop = false;
    }
  });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player?.playing ?? false });

  function handlePress() {
    if (!player) return;
    if (isPlaying) {
      player.pause();
    } else {
      player.play();
    }
  }

  if (!token) {
    return null;
  }

  return (
    <View>
      <VideoView player={player} style={styles.video} />
      <Button title={isPlaying ? ar.sampleRecording.pause : ar.sampleRecording.play} onPress={handlePress} />
    </View>
  );
}

const styles = StyleSheet.create({
  video: { width: '100%', aspectRatio: 3 / 4, marginBottom: 8 },
});
