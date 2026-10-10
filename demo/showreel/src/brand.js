import { loadFont as loadInterTight } from '@remotion/google-fonts/InterTight';
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono';

const inter = loadInterTight('normal', { weights: ['400', '500', '600'], subsets: ['latin'] });
const mono = loadMono('normal', { weights: ['400', '500', '700'], subsets: ['latin'] });

export const FONT = inter.fontFamily;
export const MONO = mono.fontFamily;

// v3 palette, same tokens as the website
export const C = {
  canvas: '#DCDDD7',
  lime: '#DAF36B',
  limeSoft: '#EEF9B8',
  limeDeep: '#B4CF4E',
  limeInk: '#55632C',
  olive: '#222F0E',
  olive2: '#2E3D15',
  oliveLine: '#3E4D25',
  oliveMist: '#B5C095',
  ink: '#1C250F',
  body: '#5B6152',
  sky: '#DCE8EE',
  lav: '#DEDFF6',
  tongue: '#FF5C8A',
  tongueInk: '#C92A5C',
  tongueSoft: '#FFE3EB',
  amber: '#F2B13B',
  link: '#3B6FD8',
  night: '#0B0F05',
  white: '#FFFFFF',
};

export const FPS = 60;
export const W = 1920;
export const H = 1080;
