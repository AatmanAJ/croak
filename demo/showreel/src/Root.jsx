import React from 'react';
import { Composition } from 'remotion';
import { Showreel } from './Showreel';
import { FPS, H, W } from './brand';
import timeline from '../timeline.json';

export function Root() {
  return <Composition id="Showreel" component={Showreel} durationInFrames={Math.round(timeline.duration * FPS)} fps={FPS} width={W} height={H} />;
}
