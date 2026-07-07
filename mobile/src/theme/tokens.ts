export type AgeGroup = 'child' | 'teen' | 'adult';

export interface ThemeTokens {
  colors: {
    background: string;
    surface: string;
    primary: string;
    onPrimary: string;
    text: string;
    textSecondary: string;
    border: string;
    danger: string;
  };
  radius: { sm: number; md: number; lg: number };
  spacing: { sm: number; md: number; lg: number };
}

export const tokens: Record<AgeGroup, ThemeTokens> = {
  child: {
    colors: {
      background: '#FFF4E0',
      surface: '#FFFFFF',
      primary: '#FF8A3D',
      onPrimary: '#FFF4E0',
      text: '#7A3E00',
      textSecondary: '#A5652A',
      border: '#F2D9B8',
      danger: '#D64545',
    },
    radius: { sm: 12, md: 20, lg: 28 },
    spacing: { sm: 8, md: 16, lg: 24 },
  },
  teen: {
    colors: {
      background: '#101422',
      surface: '#1A2033',
      primary: '#35E0C7',
      onPrimary: '#06231D',
      text: '#F2FFFC',
      textSecondary: '#8FA0AE',
      border: '#2A3348',
      danger: '#FF6B6B',
    },
    radius: { sm: 6, md: 8, lg: 12 },
    spacing: { sm: 8, md: 16, lg: 24 },
  },
  adult: {
    colors: {
      background: '#F4F6F8',
      surface: '#FFFFFF',
      primary: '#2A6F97',
      onPrimary: '#F4F6F8',
      text: '#1C2B36',
      textSecondary: '#5B6B77',
      border: '#DCE3E8',
      danger: '#C0392B',
    },
    radius: { sm: 6, md: 8, lg: 12 },
    spacing: { sm: 8, md: 16, lg: 24 },
  },
};
