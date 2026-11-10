/** One angular icon set, drawn to match the notched shapes. No emoji and no icon font. */
type P = { size?: number; filled?: boolean };
const Svg = ({ size = 20, children }: { size?: number | undefined; children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="miter" strokeLinecap="square" aria-hidden="true" focusable="false">
    {children}
  </svg>
);

export const IconHome = ({ size, filled }: P) => <Svg size={size}><path d="M3 11 12 3l9 8v10h-6v-6H9v6H3z" fill={filled ? 'currentColor' : 'none'} /></Svg>;
export const IconSearch = ({ size }: P) => <Svg size={size}><path d="M10 3h4l5 5v4l-5 5h-4l-5-5V8zM17.5 17.5 22 22" /></Svg>;
export const IconBell = ({ size, filled }: P) => <Svg size={size}><path d="M6 17V9l4-5h4l4 5v8l2 2H4zM10 22h4" fill={filled ? 'currentColor' : 'none'} /></Svg>;
export const IconBookmark = ({ size, filled }: P) => <Svg size={size}><path d="M6 3h12v18l-6-5-6 5z" fill={filled ? 'currentColor' : 'none'} /></Svg>;
export const IconUser = ({ size, filled }: P) => <Svg size={size}><path d="M9 3h6l2 2v5l-2 2H9l-2-2V5zM3 21v-3l4-3h10l4 3v3z" fill={filled ? 'currentColor' : 'none'} /></Svg>;
export const IconGear = ({ size }: P) => <Svg size={size}><path d="M9 3h6l1 3 3 1 2 3-2 3 0 2-3 1-1 3H9l-1-3-3-1-2-3 2-3V8l3-1zM12 9.5l2.5 2.5-2.5 2.5L9.5 12z" /></Svg>;
export const IconReply = ({ size }: P) => <Svg size={size}><path d="M9 5 3 11l6 6M3 11h12l6 5v3" /></Svg>;
export const IconRepost = ({ size }: P) => <Svg size={size}><path d="M4 11V6h13M14 3l3 3-3 3M20 13v5H7M10 21l-3-3 3-3" /></Svg>;
export const IconQuote = ({ size }: P) => <Svg size={size}><path d="M4 5h16v11h-6l-4 4v-4H4zM9 9v3M13 9v3" /></Svg>;
export const IconHeart = ({ size, filled }: P) => <Svg size={size}><path d="M12 21 3 12V7l3-3h3l3 3 3-3h3l3 3v5z" fill={filled ? 'currentColor' : 'none'} /></Svg>;
export const IconShare = ({ size }: P) => <Svg size={size}><path d="M12 15V3M8 7l4-4 4 4M4 13v8h16v-8" /></Svg>;
export const IconMore = ({ size }: P) => <Svg size={size}><path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth="3" /></Svg>;
export const IconClose = ({ size }: P) => <Svg size={size}><path d="m5 5 14 14M19 5 5 19" /></Svg>;
export const IconBack = ({ size }: P) => <Svg size={size}><path d="M20 12H5M11 6l-6 6 6 6" /></Svg>;
export const IconPin = ({ size }: P) => <Svg size={size}><path d="M9 3h6l3 6-3 3v3H9v-3L6 9zM12 15v6" /></Svg>;
export const IconFlag = ({ size }: P) => <Svg size={size}><path d="M5 22V3h14l-3 5 3 5H5" /></Svg>;
export const IconPlus = ({ size }: P) => <Svg size={size}><path d="M12 4v16M4 12h16" /></Svg>;
export const IconWarn = ({ size }: P) => <Svg size={size}><path d="m12 3 10 18H2zM12 10v5M12 18v.01" /></Svg>;
