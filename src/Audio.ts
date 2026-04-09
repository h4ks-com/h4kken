import '@babylonjs/core/Audio/audioSceneComponent';
import '@babylonjs/core/Audio/audioEngine';
import { type Scene, Sound, type Vector3 } from '@babylonjs/core';

const SPATIAL_OPTS = {
  loop: false,
  autoplay: false,
  spatialSound: true,
  distanceModel: 'linear' as const,
  rolloffFactor: 0.1,
  maxDistance: 100,
} as const;

const FLAT_OPTS = {
  loop: false,
  autoplay: false,
  spatialSound: false,
} as const;

const MANIFEST: Record<string, { files: string[]; spatial: boolean }> = {
  hit_heavy: {
    spatial: true,
    files: [
      'hit_heavy_000.ogg',
      'hit_heavy_001.ogg',
      'hit_heavy_002.ogg',
      'hit_heavy_003.ogg',
      'hit_heavy_004.ogg',
    ],
  },
  hit_light: {
    spatial: true,
    files: ['hit_light_000.ogg', 'hit_light_001.ogg'],
  },
  block: {
    spatial: true,
    files: ['block_000.ogg', 'block_001.ogg', 'block_002.ogg'],
  },
  ko_bell: { spatial: false, files: ['ko_bell.ogg'] },
  announce_fight: { spatial: false, files: ['announce_fight.ogg'] },
  announce_ready: { spatial: false, files: ['announce_ready.ogg'] },
  announce_round1: { spatial: false, files: ['announce_round1.ogg'] },
  announce_round2: { spatial: false, files: ['announce_round2.ogg'] },
  announce_finalround: { spatial: false, files: ['announce_finalround.ogg'] },
  announce_winner: { spatial: false, files: ['announce_winner.ogg'] },
  announce_youwin: { spatial: false, files: ['announce_youwin.ogg'] },
  announce_time: { spatial: false, files: ['announce_time.ogg'] },
  count_3: { spatial: false, files: ['count_3.ogg'] },
  count_2: { spatial: false, files: ['count_2.ogg'] },
  count_1: { spatial: false, files: ['count_1.ogg'] },
};

export class AudioManager {
  private sounds = new Map<string, Sound[]>();
  private indices = new Map<string, number>();

  async load(scene: Scene): Promise<void> {
    const base = '/assets/sounds/';
    const promises: Promise<void>[] = [];

    for (const [name, { files, spatial }] of Object.entries(MANIFEST)) {
      const opts = spatial ? SPATIAL_OPTS : FLAT_OPTS;
      const loaded: Sound[] = [];

      for (const file of files) {
        promises.push(
          new Promise<void>((resolve) => {
            const snd = new Sound(name, base + file, scene, resolve, opts);
            loaded.push(snd);
          }),
        );
      }

      this.sounds.set(name, loaded);
    }

    await Promise.all(promises);
  }

  // Round-robin through variants so the same sound doesn't repeat back-to-back
  private _pick(name: string): Sound | null {
    const variants = this.sounds.get(name);
    if (!variants || variants.length === 0) return null;
    const prev = this.indices.get(name) ?? -1;
    const next = (prev + 1) % variants.length;
    this.indices.set(name, next);
    return variants[next] ?? null;
  }

  // Spatial sound anchored to a world position
  playAt(name: string, pos: Vector3, volume = 1.0) {
    const snd = this._pick(name);
    if (!snd) return;
    snd.setPosition(pos);
    snd.setVolume(volume);
    snd.play();
  }

  // Non-spatial (UI / announcer) sound
  play(name: string, volume = 1.0) {
    const snd = this._pick(name);
    if (!snd) return;
    snd.setVolume(volume);
    snd.play();
  }
}
