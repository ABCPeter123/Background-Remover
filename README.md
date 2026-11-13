# Cutout Studio

A browser-based background remover with both AI-assisted cutouts and direct selection tools. Built with **React 19**, **TypeScript**, **Vite**, **Canvas**, and the open-source **IMG.LY background-removal** model.

**Live app:** https://background-remover-alpha-sooty.vercel.app

## Features

- **Upload** PNG, JPG, WebP, AVIF (browser dependent), or paste an image from your clipboard.
- **Smart select (SlimSAM):** click the exact person, animal, or object you want to select, then keep or remove it. Add positive clicks to include details, or Shift-click/right-click to exclude areas. Review the live mask preview before applying. A Web Worker caches embeddings for faster follow-up clicks.
- **Magic select:** click an area to remove connected pixels with similar colors. Hold **Shift** while clicking to restore an area.
- **AI remove background:** one-click foreground segmentation with an on-device ONNX neural network. It detects the primary subject; it is not an interactive SAM model.
- **Erase / restore brushes** to clean up fine details, with adjustable size and softness.
- **Tune selections** with color tolerance and edge feather controls.
- **Undo / redo** up to 12 mask edits. Shortcuts: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, S (Smart), V (Magic), E, R.
- **Invert** the removed region to keep the opposite side of your selection.
- **Preview** on checkerboard, white, charcoal, or mint backgrounds, with an original-image toggle.
- **Export** a transparent PNG with optional trimming of transparent borders.

Images are processed in your browser. No image uploads, accounts, image storage, or API keys are required. The optional AI feature downloads its model and WebAssembly files from IMG.LY's CDN on first use. The image itself is processed locally and not sent to a remote inference API.

## Development

```bash
npm install
npm run dev
```

Open http://localhost:5173.

Verify the build and run the mask-processing tests:

```bash
npm run test
npm run build
```

## Deployment

The app is a Vite static application. Vercel automatically deploys commits to `main`. No environment variables or backend services are required.

## Design and limitations

- The one-click IS-Net cutout identifies the primary foreground. For arbitrary objects, use **Smart Select**, powered by quantized **SlimSAM-77** (a compact Segment Anything model). It is not Meta's full SAM 2, nor Instagram's private sticker model.
- Magic select uses an iterative, contiguous, color-distance flood fill. It works best when region colors are distinguishable; it is not semantic instance segmentation.
- Very large input images are downscaled to at most 2800 pixels on the longest side and 8 megapixels total to manage browser memory. Exports use the processed image dimensions.
- SlimSAM's quantized model loads in a worker and image encoding starts when the browser is idle after an upload. A 1024px image is used for analysis. The preview uses the model-resolution mask; full-size mask upscaling is deferred until the user applies the selection. Actual latency depends on device performance.
- AI model assets may take time to download initially, and inference performance depends on the device.
- All processing is local, but downloading the optional AI model requires internet access.

## Licensing

This application is distributed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**. See [LICENSE.md](LICENSE.md).

AI background segmentation uses [@imgly/background-removal](https://github.com/imgly/background-removal-js) v1.7.0 (AGPL-3.0). Smart Select uses [SlimSAM-77](https://huggingface.co/Xenova/slimsam-77-uniform) (Apache-2.0) through [Transformers.js](https://github.com/huggingface/transformers.js) (Apache-2.0). ONNX Runtime Web is licensed under the MIT license. For different commercial license terms for IMG.LY components, contact IMG.LY.

This project is independently implemented and draws on the general interaction concept of tap-to-select sticker cutouts. It does not use or claim access to Instagram's proprietary algorithm.
