import { useId } from 'react';
import brand from './brand.json';

/** The user's original transparent artwork, colored through its alpha channel. */
export function BrandMark({ size = 28 }: { size?: number }) {
  const id = useId();
  const { x, y, size: cropSize } = brand.crop;
  return <svg className="ds-brand-symbol" width={size} height={size} viewBox={`${x} ${y} ${cropSize} ${cropSize}`} aria-hidden="true" focusable="false">
    <defs><mask id={id} maskUnits="userSpaceOnUse" x={x} y={y} width={cropSize} height={cropSize} style={{ maskType: 'alpha' }}>
      <image href={brand.source} width={brand.width} height={brand.height} />
    </mask></defs>
    <rect x={x} y={y} width={cropSize} height={cropSize} fill="currentColor" mask={`url(#${id})`} />
  </svg>;
}
