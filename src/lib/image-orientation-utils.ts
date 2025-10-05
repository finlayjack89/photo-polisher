// src/lib/image-orientation-utils.ts

/**
 * Read EXIF orientation from image file
 */
const getOrientation = (file: File): Promise<number> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const view = new DataView(e.target?.result as ArrayBuffer);
      if (view.getUint16(0, false) !== 0xFFD8) {
        resolve(1); // Not a JPEG, default orientation
        return;
      }
      const length = view.byteLength;
      let offset = 2;
      while (offset < length) {
        if (view.getUint16(offset + 2, false) <= 8) {
          resolve(1);
          return;
        }
        const marker = view.getUint16(offset, false);
        offset += 2;
        if (marker === 0xFFE1) {
          const little = view.getUint16(offset + 8, false) === 0x4949;
          offset += view.getUint16(offset, false);
          const tags = view.getUint16(offset, little);
          offset += 2;
          for (let i = 0; i < tags; i++) {
            if (view.getUint16(offset + (i * 12), little) === 0x0112) {
              resolve(view.getUint16(offset + (i * 12) + 8, little));
              return;
            }
          }
        } else if ((marker & 0xFF00) !== 0xFF00) {
          break;
        } else {
          offset += view.getUint16(offset, false);
        }
      }
      resolve(1);
    };
    reader.onerror = () => resolve(1);
    reader.readAsArrayBuffer(file);
  });
};

/**
 * Apply orientation transformation to canvas context
 */
export const applyOrientation = (
  ctx: CanvasRenderingContext2D,
  orientation: number,
  width: number,
  height: number
) => {
  switch (orientation) {
    case 2:
      // Horizontal flip
      ctx.transform(-1, 0, 0, 1, width, 0);
      break;
    case 3:
      // 180° rotation
      ctx.transform(-1, 0, 0, -1, width, height);
      break;
    case 4:
      // Vertical flip
      ctx.transform(1, 0, 0, -1, 0, height);
      break;
    case 5:
      // Vertical flip + 90° CW
      ctx.transform(0, 1, 1, 0, 0, 0);
      break;
    case 6:
      // 90° CW
      ctx.transform(0, 1, -1, 0, height, 0);
      break;
    case 7:
      // Horizontal flip + 90° CW
      ctx.transform(0, -1, -1, 0, height, width);
      break;
    case 8:
      // 90° CCW
      ctx.transform(0, -1, 1, 0, 0, width);
      break;
    default:
      // No transformation needed
      break;
  }
};

/**
 * Correct image orientation by reading EXIF data and applying proper transformation
 */
export const correctImageOrientation = async (file: File): Promise<File> => {
  try {
    console.log(`Correcting orientation for: ${file.name}`);
    
    // Get EXIF orientation
    const orientation = await getOrientation(file);
    console.log(`EXIF orientation value: ${orientation}`);
    
    // If orientation is 1 (normal), no correction needed
    if (orientation === 1) {
      console.log('No orientation correction needed');
      return file;
    }
    
    // Create image element
    const img = await createImageBitmap(file);
    
    // Determine canvas dimensions based on orientation
    let canvas: HTMLCanvasElement;
    let ctx: CanvasRenderingContext2D;
    
    if (orientation >= 5 && orientation <= 8) {
      // For 90° or 270° rotations, swap width and height
      canvas = document.createElement('canvas');
      canvas.width = img.height;
      canvas.height = img.width;
    } else {
      canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
    }
    
    ctx = canvas.getContext('2d')!;
    
    // Apply orientation transformation
    applyOrientation(ctx, orientation, img.width, img.height);
    
    // Draw image with correct orientation
    ctx.drawImage(img, 0, 0);
    
    // Convert canvas to blob
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => b ? resolve(b) : reject(new Error('Failed to create blob')),
        file.type || 'image/png',
        1.0
      );
    });
    
    // Create new file with corrected orientation
    const correctedFile = new File([blob], file.name, {
      type: file.type || 'image/png',
      lastModified: Date.now(),
    });
    
    console.log(`Orientation corrected from ${orientation} to 1 (normal)`);
    return correctedFile;
  } catch (error) {
    console.error('Error correcting image orientation:', error);
    return file; // Return original file if correction fails
  }
};
