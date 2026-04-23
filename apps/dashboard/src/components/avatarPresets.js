import ink01 from '../assets/avatars/ink-01.svg';
import ink02 from '../assets/avatars/ink-02.svg';
import ink03 from '../assets/avatars/ink-03.svg';
import ink04 from '../assets/avatars/ink-04.svg';
import ink05 from '../assets/avatars/ink-05.svg';
import ink06 from '../assets/avatars/ink-06.svg';

export const AVATAR_PRESETS = [
  { key: 'ink-01', src: ink01 },
  { key: 'ink-02', src: ink02 },
  { key: 'ink-03', src: ink03 },
  { key: 'ink-04', src: ink04 },
  { key: 'ink-05', src: ink05 },
  { key: 'ink-06', src: ink06 }
];

export const getAvatarSrc = (avatarKey) => {
  const key = (avatarKey || '').toString().trim();
  const found = AVATAR_PRESETS.find((a) => a.key === key);
  return found ? found.src : null;
};
