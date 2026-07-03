import { useMemo } from 'react';

export function useWebGLSupport(): boolean {
  return useMemo(() => {
    try {
      const canvas = document.createElement('canvas');
      return Boolean(
        window.WebGLRenderingContext &&
          (canvas.getContext('webgl2') || canvas.getContext('webgl')),
      );
    } catch {
      return false;
    }
  }, []);
}
