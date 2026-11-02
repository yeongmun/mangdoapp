// 남은 수가 이 화면에서 0이 되는 순간을 안다(2026-11-02) — 처음부터 0이면 축하하지 않는다.
// 그리는 도중에 판단한다: 다 찍은 카드가 처음 그려질 때 이미 celebrate=true여야 ✓가 톡 튀어나온다.
import { useState } from 'react';

export function useCelebrate(left: number, ready: boolean): boolean {
  const [prev, setPrev] = useState<number | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  if (ready && prev !== left) {
    if (prev !== null && prev > 0 && left === 0) setCelebrate(true);
    else if (left > 0 && celebrate) setCelebrate(false);
    setPrev(left);
  }
  return celebrate;
}
