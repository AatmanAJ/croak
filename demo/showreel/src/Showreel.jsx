import React from 'react';
import { AbsoluteFill, Sequence } from 'remotion';
import { CameraMotionBlur } from '@remotion/motion-blur';
import { FPS } from './brand';
import { Grain } from './lib';
import { Intro } from './scenes/Intro';
import { Meet } from './scenes/Meet';
import { How } from './scenes/How';
import { Montage } from './scenes/Montage';
import { Mods } from './scenes/Mods';
import { Setup } from './scenes/Setup';
import { End } from './scenes/End';

// scene boundaries match timeline.json; audio is mixed separately (see render.sh)
// [start, end, scene, motion blur samples (0 = none)]
const SCENES = [
  [0, 8, Intro, 6],
  [8, 12, Meet, 6],
  [12, 16, How, 5],
  [16, 22, Montage, 7],
  [22, 28, Mods, 0],
  [28, 32, Setup, 5],
  [32, 36, End, 6],
];

export function Showreel() {
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {SCENES.map(([start, end, Scene, blur]) => (
        <Sequence key={start} from={Math.round(start * FPS)} durationInFrames={Math.round((end - start) * FPS)}>
          {blur ? (
            <CameraMotionBlur shutterAngle={200} samples={blur}>
              <Scene />
            </CameraMotionBlur>
          ) : (
            <Scene />
          )}
        </Sequence>
      ))}
      <Grain opacity={0.08} />
    </AbsoluteFill>
  );
}
