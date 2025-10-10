/**
 * Canvas utilities for AI commercial photo editing workflow
 * Handles client-side precision operations for mask correction and background removal
 */

/**
 * Step 3: Client-Side Mask Correction
 * Converts black areas in AI-generated masks to transparent
 */
export const convertBlackToTransparent = (imageDataUrl: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return reject('Could not get canvas context');

      ctx.drawImage(image, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      for (let i = 0; i < data.length; i += 4) {
        // If pixel is black or near-black, make it transparent
        if (data[i] < 50 && data[i + 1] < 50 && data[i + 2] < 50) {
          data[i + 3] = 0; // Set alpha channel to 0 (fully transparent)
        }
      }
      
      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    image.onerror = reject;
    image.src = imageDataUrl;
  });
};

/**
 * Step 4: Client-Side Background Removal
 * Uses corrected mask to perform pixel-perfect cutout
 */
export const applyMaskToImage = (originalImageDataUrl: string, maskImageDataUrl: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const originalImage = new Image();
    const maskImage = new Image();
    let loadedCount = 0;

    const onImageLoad = () => {
      loadedCount++;
      if (loadedCount === 2) {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = originalImage.naturalWidth;
          canvas.height = originalImage.naturalHeight;
          const ctx = canvas.getContext('2d');
          
          if (!ctx) return reject('Could not get canvas context');

          // 1. Draw the original image
          ctx.drawImage(originalImage, 0, 0);

          // 2. Set composite operation: keeps destination pixels that are within the source
          ctx.globalCompositeOperation = 'destination-in';

          // 3. Draw the mask, scaled to fit, on top to perform the "cut"
          ctx.drawImage(maskImage, 0, 0, canvas.width, canvas.height);

          resolve(canvas.toDataURL('image/png'));
        } catch (error) {
          reject(error);
        }
      }
    };

    originalImage.onload = onImageLoad;
    maskImage.onload = onImageLoad;
    originalImage.onerror = reject;
    maskImage.onerror = reject;
    
    originalImage.src = originalImageDataUrl;
    maskImage.src = maskImageDataUrl;
  });
};

/**
 * Step 5: Backdrop & Placement
 * Positions subject on transparent canvas matching backdrop dimensions
 */
export interface SubjectPlacement {
  x: number; // fraction of canvas width (0-1)
  y: number; // fraction of canvas height (0-1)
  scale: number; // fraction of canvas width for subject width
}

export const positionSubjectOnCanvas = (
  subjectDataUrl: string, 
  targetWidth: number, 
  targetHeight: number, 
  placement: SubjectPlacement
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    
    if (!ctx) return reject('Could not get canvas context');

    const subjectImage = new Image();
    subjectImage.onload = () => {
      try {
        // Calculate dimensions maintaining aspect ratio
        const subjectAspectRatio = subjectImage.naturalWidth / subjectImage.naturalHeight;
        const scaledWidth = targetWidth * placement.scale;
        const scaledHeight = scaledWidth / subjectAspectRatio;
        
        // Calculate position (centered on the placement point)
        const dx = (placement.x * targetWidth) - (scaledWidth / 2);
        const dy = (placement.y * targetHeight) - (scaledHeight / 2);

        console.log('positionSubjectOnCanvas - Positioning details:', {
          targetDimensions: `${targetWidth}x${targetHeight}`,
          subjectDimensions: `${subjectImage.naturalWidth}x${subjectImage.naturalHeight}`,
          placement: placement,
          calculatedSize: `${Math.round(scaledWidth)}x${Math.round(scaledHeight)}`,
          calculatedPosition: `${Math.round(dx)}, ${Math.round(dy)}`,
          scaleAsPixels: Math.round(scaledWidth),
          scaleAsPercentage: Math.round(placement.scale * 100) + '%'
        });

        // Draw subject on transparent canvas
        ctx.drawImage(subjectImage, dx, dy, scaledWidth, scaledHeight);
        resolve(canvas.toDataURL('image/png'));
      } catch (error) {
        reject(error);
      }
    };
    
    subjectImage.onerror = reject;
    subjectImage.src = subjectDataUrl;
  });
};

/**
 * Utility to get image dimensions from data URL
 */
export const getImageDimensions = (dataUrl: string): Promise<{ width: number; height: number }> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
};

/**
 * Convert File to data URL
 */
export const fileToDataUrl = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) {
        resolve(e.target.result as string);
      } else {
        reject('Failed to read file');
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

/**
 * Composite backdrop, reflection, and subject to create final image
 * Layers: backdrop → reflection → subject (with shadow)
 */
export const compositeLayers = async (
  backdropUrl: string,
  subjectUrl: string,
  placement: SubjectPlacement,
  reflectionUrl?: string
): Promise<string> => {
  console.log('🎨 COMPOSITING: Starting layer composition');
  console.log('📊 Input validation:', {
    backdropLength: backdropUrl?.length,
    subjectLength: subjectUrl?.length,
    backdropFormat: backdropUrl?.substring(0, 50),
    subjectFormat: subjectUrl?.substring(0, 50),
    placement
  });

  // Validate inputs
  if (!subjectUrl?.includes('data:image/png')) {
    const error = 'ERROR: Subject image must be PNG with transparency';
    console.error('🚨', error);
    throw new Error(error);
  }
  
  if (!backdropUrl?.startsWith('data:image/')) {
    const error = 'ERROR: Invalid backdrop data format';
    console.error('🚨', error);
    throw new Error(error);
  }
  
  console.log('✅ Input validation passed');

  // Helper function to load image
  const loadImage = (src: string, name: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      
      img.onload = () => {
        console.log(`Successfully loaded ${name}: ${img.width}x${img.height}`);
        resolve(img);
      };
      
      img.onerror = (error) => {
        console.error(`Failed to load ${name}:`, error);
        reject(new Error(`Failed to load ${name} image`));
      };
      
      img.src = src;
    });
  };

  try {
    // Load backdrop, subject, and reflection images
    console.log('Loading backdrop, subject, and reflection images...');
    const imagesToLoad: Promise<HTMLImageElement>[] = [
      loadImage(backdropUrl, 'backdrop'),
      loadImage(subjectUrl, 'subject')
    ];
    
    if (reflectionUrl) {
      imagesToLoad.push(loadImage(reflectionUrl, 'reflection'));
    }
    
    const loadedImages = await Promise.all(imagesToLoad);
    const backdrop = loadedImages[0];
    const subject = loadedImages[1];
    const reflection = reflectionUrl ? loadedImages[2] : null;

    console.log('All images loaded successfully', reflection ? 'including reflection' : '');

    // Create canvas with backdrop dimensions
    const canvas = document.createElement('canvas');
    canvas.width = backdrop.width;
    canvas.height = backdrop.height;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      throw new Error('Failed to get canvas context');
    }

    console.log('Canvas created:', `${canvas.width}x${canvas.height}`);

    // Draw backdrop
    console.log('Drawing backdrop...');
    ctx.drawImage(backdrop, 0, 0);

    // Calculate subject positioning based on placement settings
    const subjectAspectRatio = subject.naturalWidth / subject.naturalHeight;
    const scaledWidth = canvas.width * placement.scale;
    const scaledHeight = scaledWidth / subjectAspectRatio;
    const dx = (placement.x * canvas.width) - (scaledWidth / 2);
    const dy = (placement.y * canvas.height) - (scaledHeight / 2);
    
    console.log('Subject positioning:', {
      originalSize: `${subject.naturalWidth}x${subject.naturalHeight}`,
      scaledSize: `${Math.round(scaledWidth)}x${Math.round(scaledHeight)}`,
      position: `${Math.round(dx)}, ${Math.round(dy)}`,
      placement
    });

    // Draw reflection FIRST (positioned directly below subject)
    if (reflection) {
      console.log('Drawing reflection below subject...');
      
      // CRITICAL FIX: The shadowedData has 1.5x padding from Cloudinary's drop shadow transformation
      // The actual subject within the shadowedData takes up 1/1.5 = 66.7% of the image
      // and is centered, so we need to adjust the reflection position accordingly
      const paddingMultiplier = 1.5; // Matches add-drop-shadow edge function
      const subjectRatio = 1 / paddingMultiplier; // 0.667
      const paddingRatio = (1 - subjectRatio) / 2; // 0.167 (padding on each side)
      
      // Calculate the actual subject dimensions within the padded shadowedData
      const actualSubjectHeight = scaledHeight * subjectRatio;
      const paddingTop = scaledHeight * paddingRatio;
      
      // Reflection must match the ACTUAL subject's width (accounting for padding)
      const actualSubjectWidth = scaledWidth * subjectRatio;
      const paddingLeft = scaledWidth * paddingRatio;
      const reflectionScaledWidth = actualSubjectWidth;
      
      // Calculate reflection height as proportion of actual subject height
      const reflectionHeightRatio = reflection.naturalHeight / subject.naturalHeight;
      const reflectionScaledHeight = actualSubjectHeight * reflectionHeightRatio;
      
      // Position reflection at the bottom of the ACTUAL subject (not the padded image)
      const actualSubjectDx = dx + paddingLeft;
      const actualSubjectDy = dy + paddingTop;
      const reflectionDx = actualSubjectDx;
      let reflectionDy = actualSubjectDy + actualSubjectHeight; // No gap for surface reflection
      
      // Check how much of the reflection fits within canvas bounds
      let availableHeightForReflection = canvas.height - reflectionDy;
      const minimumVisiblePercent = 0.7; // Ensure at least 70% of reflection is visible
      
      // If less than 30% of the reflection would be visible, reposition it higher
      if (availableHeightForReflection < reflectionScaledHeight * (1 - minimumVisiblePercent)) {
        // Position reflection so that 70% is visible, overlapping with lower part of subject if needed
        reflectionDy = canvas.height - (reflectionScaledHeight * minimumVisiblePercent);
        availableHeightForReflection = canvas.height - reflectionDy;
        console.log('⚠️ Reflection repositioned higher to ensure visibility (subject positioned too low)');
      }
      
      console.log('Reflection positioning (accounting for 1.5x padding):', {
        shadowedDataSize: `${Math.round(scaledWidth)}x${Math.round(scaledHeight)}`,
        actualSubjectSize: `${Math.round(actualSubjectWidth)}x${Math.round(actualSubjectHeight)}`,
        paddingOffset: `${Math.round(paddingLeft)}, ${Math.round(paddingTop)}`,
        reflectionSize: `${Math.round(reflectionScaledWidth)}x${Math.round(reflectionScaledHeight)}`,
        reflectionPosition: `${Math.round(reflectionDx)}, ${Math.round(reflectionDy)}`,
        canvasHeight: canvas.height,
        availableHeight: Math.round(availableHeightForReflection),
        visiblePercent: `${((availableHeightForReflection / reflectionScaledHeight) * 100).toFixed(1)}%`,
        willBeClipped: reflectionScaledHeight > availableHeightForReflection,
        heightRatio: `${(reflectionHeightRatio * 100).toFixed(1)}%`
      });
      
      // Only draw the portion of the reflection that fits within the canvas
      if (availableHeightForReflection > 0) {
        const reflectionHeightToDraw = Math.min(reflectionScaledHeight, availableHeightForReflection);
        const reflectionSourceHeightRatio = reflectionHeightToDraw / reflectionScaledHeight;
        
        // Use 9-parameter drawImage to clip the source image
        ctx.drawImage(
          reflection,
          0, 0, // source x, y (start from top of reflection)
          reflection.naturalWidth, // source width (full width)
          reflection.naturalHeight * reflectionSourceHeightRatio, // source height (clipped proportion)
          reflectionDx, reflectionDy, // destination x, y
          reflectionScaledWidth, // destination width
          reflectionHeightToDraw // destination height (clipped to canvas bounds)
        );
        
        console.log('Reflection drawn with clipping:', {
          sourceHeight: `${reflection.naturalHeight} -> ${Math.round(reflection.naturalHeight * reflectionSourceHeightRatio)}`,
          destHeight: `${Math.round(reflectionScaledHeight)} -> ${Math.round(reflectionHeightToDraw)}`,
          clippedPercent: `${((1 - reflectionSourceHeightRatio) * 100).toFixed(1)}%`
        });
      } else {
        console.warn('Reflection completely outside canvas bounds - not drawn');
      }
    }
    
    // Draw subject WITH shadow on top of reflection
    console.log('Drawing subject with shadow...');
    ctx.drawImage(subject, dx, dy, scaledWidth, scaledHeight);

    // Return the final composited image as a high-quality data URL
    const finalDataUrl = canvas.toDataURL('image/png');
    console.log('Compositing complete, final image size:', finalDataUrl.length);
    
    return finalDataUrl;

  } catch (error) {
    console.error('Error during compositing:', error);
    throw error;
  }
};


/**
 * Create a preview image for display purposes (with max dimensions)
 */
export const createPreviewImage = (dataUrl: string, maxWidth: number = 400, maxHeight: number = 400): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      if (!ctx) return reject('Could not get canvas context');

      // Calculate scaled dimensions
      let { width, height } = img;
      const aspectRatio = width / height;

      if (width > maxWidth) {
        width = maxWidth;
        height = width / aspectRatio;
      }
      if (height > maxHeight) {
        height = maxHeight;
        width = height * aspectRatio;
      }

      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);
      
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
};
