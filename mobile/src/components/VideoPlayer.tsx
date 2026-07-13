import { useEffect, useState } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEvent } from 'expo';
import { Button } from './Button';
import { ErrorBanner } from './ErrorBanner';
import { ar } from '../copy/ar';
import { getToken } from '../storage/session';
import { API_BASE_URL } from '../api/client';

interface VideoPlayerProps {
  path: string;
}

export function VideoPlayer({ path }: VideoPlayerProps) {
  const [token, setToken] = useState<string | null>(null);
  // HTML <video> elements (used by expo-video's web implementation) cannot attach custom
  // request headers, so the Authorization header used on native is fetched here instead and
  // exchanged for a same-origin blob: URL that useVideoPlayer can play without auth.
  const [webBlobUrl, setWebBlobUrl] = useState<string | null>(null);
  const [webError, setWebError] = useState<string | null>(null);

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

  useEffect(() => {
    if (Platform.OS !== 'web' || !token) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setWebError(null);
    fetch(`${API_BASE_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to fetch video (status ${res.status})`);
        }
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setWebBlobUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) {
          setWebError('حدث خطأ غير متوقع');
        }
      });
    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [token, path]);

  const source =
    Platform.OS === 'web'
      ? webBlobUrl
      : token
        ? { uri: `${API_BASE_URL}${path}`, headers: { Authorization: `Bearer ${token}` } }
        : null;
  const player = useVideoPlayer(source, (p) => {
    if (p) {
      p.loop = false;
    }
  });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player?.playing ?? false });
  // statusChange is part of the shared VideoPlayer API (not platform-specific), so this covers
  // native playback failures (network error, expired token, unsupported source) the same way
  // the web-only fetch handling above covers failures before the player ever gets a source.
  const { status } = useEvent(player, 'statusChange', { status: player?.status ?? 'idle' });

  function handlePress() {
    if (!player) return;
    if (isPlaying) {
      player.pause();
    } else {
      player.play();
    }
  }

  if (webError || status === 'error') {
    return <ErrorBanner message={webError ?? 'حدث خطأ غير متوقع'} />;
  }

  const ready = Platform.OS === 'web' ? !!webBlobUrl : !!token;
  if (!ready) {
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
