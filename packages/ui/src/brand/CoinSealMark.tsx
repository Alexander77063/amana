import { Polygon, Svg } from 'react-native-svg';

const OUTER_HEX = '50,3 90.7,26.5 90.7,73.5 50,97 9.3,73.5 9.3,26.5';
const BODY_HEX = '50,10 84.6,30 84.6,70 50,90 15.4,70 15.4,30';
const INNER_RING = '50,17 78.6,33.5 78.6,66.5 50,83 21.4,66.5 21.4,33.5';
const KHATAM =
  '50,38 51.91,45.38 58.49,41.51 54.62,48.09 62,50 54.62,51.91 58.49,58.49 51.91,54.62 50,62 48.09,54.62 41.51,58.49 45.38,51.91 38,50 45.38,48.09 41.51,41.51 48.09,45.38';

type Variant = 'default' | 'agent' | 'principal' | 'mono-light' | 'mono-white';

const VARIANT_COLORS: Record<Variant, { rim: string; body: string }> = {
  default: { rim: '#C9A227', body: '#0D1B2A' },
  agent: { rim: '#2563EB', body: '#0D1B2A' },
  principal: { rim: '#D97706', body: '#0D1B2A' },
  'mono-light': { rim: '#0D1B2A', body: 'transparent' },
  'mono-white': { rim: '#FFFFFF', body: 'transparent' },
};

type Props = {
  size: number;
  variant?: Variant;
};

export function CoinSealMark({ size, variant = 'default' }: Props) {
  const { rim, body } = VARIANT_COLORS[variant];
  const isTransparent = body === 'transparent';

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {/* Layer 1: outer rim (thick gold hexagon) */}
      <Polygon points={OUTER_HEX} fill={rim} />
      {/* Layer 2: navy body (sits on rim, creates border effect) */}
      {!isTransparent && <Polygon points={BODY_HEX} fill={body} />}
      {/* Layer 3: inner ring stroke */}
      <Polygon points={INNER_RING} fill="none" stroke={rim} strokeWidth="1.5" />
      {/* Layer 4: 8-pointed khatam star */}
      <Polygon points={KHATAM} fill={rim} />
    </Svg>
  );
}
