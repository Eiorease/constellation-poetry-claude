import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// viteSingleFile inlines all JS/CSS into dist/index.html so the built file
// can be opened directly via file:// (double-click), no server needed.
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
});
