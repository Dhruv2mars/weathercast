import { useColorScheme } from 'react-native';

const light = {
  background: '#F7F9FC',
  surface: '#FFFFFF',
  elevated: '#EDF2F8',
  text: '#0B1526',
  secondaryText: '#4B5B70',
  accent: '#1768E5',
  accentSoft: '#DCE9FF',
  rain: '#2089D8',
  heavyRain: '#6B4CE6',
  destructive: '#B42318',
  success: '#16794A',
  separator: '#D6DEE9',
};

const dark = {
  background: '#07101D',
  surface: '#101C2C',
  elevated: '#17263A',
  text: '#F5F8FC',
  secondaryText: '#AAB9CC',
  accent: '#72A7FF',
  accentSoft: '#18365F',
  rain: '#5CB6EF',
  heavyRain: '#A78BFA',
  destructive: '#FF8A82',
  success: '#58C892',
  separator: '#2B3B50',
};

export const themes = { light, dark };
export type AppTheme = typeof light;

export function useAppTheme(): AppTheme {
  return useColorScheme() === 'dark' ? dark : light;
}

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 };
export const maxContentWidth = 720;
