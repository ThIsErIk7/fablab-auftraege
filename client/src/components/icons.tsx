// Schlanke Strich-Icons (statt Emojis), 24er Raster, erben die Textfarbe.
import type { SVGProps } from 'react';

const P = ({ d, ...p }: { d: string } & SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" width="1.15em" height="1.15em" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="square" strokeLinejoin="miter" aria-hidden {...p}><path d={d} /></svg>
);
type I = SVGProps<SVGSVGElement>;
export const IconTrash = (p: I) => <P d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" {...p} />;
export const IconEdit = (p: I) => <P d="M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4" {...p} />;
export const IconCopy = (p: I) => <P d="M8 8h12v12H8zM4 16V4h12" {...p} />;
export const IconFile = (p: I) => <P d="M6 3h8l4 4v14H6zM14 3v4h4" {...p} />;
export const IconAlert = (p: I) => <P d="M12 3l10 18H2zM12 10v5M12 18v.5" {...p} />;
export const IconLock = (p: I) => <P d="M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4" {...p} />;
export const IconCheck = (p: I) => <P d="M4 12l5 5L20 6" {...p} />;
export const IconX = (p: I) => <P d="M5 5l14 14M19 5L5 19" {...p} />;
export const IconPlus = (p: I) => <P d="M12 4v16M4 12h16" {...p} />;
export const IconArrowLeft = (p: I) => <P d="M20 12H4M10 6l-6 6 6 6" {...p} />;
export const IconArrowRight = (p: I) => <P d="M4 12h16M14 6l6 6-6 6" {...p} />;
export const IconChevron = (p: I) => <P d="M9 6l6 6-6 6" {...p} />;
export const IconSun = (p: I) => <P d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5" {...p} />;
export const IconMoon = (p: I) => <P d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z" {...p} />;
export const IconAuto = (p: I) => <P d="M12 3a9 9 0 1 0 0 18zM12 3a9 9 0 0 1 0 18" {...p} />;
export const IconPlay = (p: I) => <P d="M7 4l13 8-13 8z" {...p} />;
export const IconRefresh = (p: I) => <P d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4" {...p} />;
export const IconDownload = (p: I) => <P d="M12 3v12M7 10l5 5 5-5M4 21h16" {...p} />;
export const IconUpload = (p: I) => <P d="M12 15V3M7 8l5-5 5 5M4 21h16" {...p} />;
export const IconSearch = (p: I) => <P d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5" {...p} />;
export const IconUp = (p: I) => <P d="M12 19V5M6 11l6-6 6 6" {...p} />;
export const IconDown = (p: I) => <P d="M12 5v14M6 13l6 6 6-6" {...p} />;
export const IconExternal = (p: I) => <P d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" {...p} />;
