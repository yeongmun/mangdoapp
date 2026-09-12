// 균열을 SVG로 그린다. 저장은 world 좌표로 하고, 그릴 때마다 현재 카메라 기준 화면 좌표로 바꾼다.

const SVG_NS = 'http://www.w3.org/2000/svg';
export const CRACK_COLOR = '#e53935';
export const SELECTED_COLOR = '#fb8c00';
// 화면 기준 선 굵기(px). 줌과 무관하게 일정하다. 굵기를 바꾸려면 이 값만 고치면 된다.
export const CRACK_WIDTH_PX = 1;
export const SELECTED_WIDTH_PX = 2;

function polylineElement(points, color, width, opacity) {
  const el = document.createElementNS(SVG_NS, 'polyline');
  el.setAttribute('points', points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '));
  el.setAttribute('fill', 'none');
  el.setAttribute('stroke', color);
  el.setAttribute('stroke-width', String(width));
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
  el.setAttribute('opacity', String(opacity));
  return el;
}

export function createOverlay(svg, mapper) {
  let damages = [];
  let selectedId = null;
  let draft = null;
  let frame = 0;

  function render() {
    frame = 0;
    const elements = damages.map((damage) => {
      const selected = damage.id === selectedId;
      const screen = damage.geometry.world.map((p) => mapper.worldToClient(p));
      return polylineElement(
        screen,
        selected ? SELECTED_COLOR : CRACK_COLOR,
        selected ? SELECTED_WIDTH_PX : CRACK_WIDTH_PX,
        1,
      );
    });
    if (draft && draft.length > 1) elements.push(polylineElement(draft, CRACK_COLOR, CRACK_WIDTH_PX, 0.6));
    svg.replaceChildren(...elements);
  }

  function requestRender() {
    if (frame === 0) frame = requestAnimationFrame(render);
  }

  return {
    setDamages(list) {
      damages = list;
      requestRender();
    },
    setSelected(id) {
      selectedId = id;
      requestRender();
    },
    setDraft(points) {
      draft = points;
      requestRender();
    },
    requestRender,
  };
}
