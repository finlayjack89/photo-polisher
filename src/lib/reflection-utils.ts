/**
 * Reflection generation utilities for product images
 * Creates realistic reflections using canvas transformations
 */

export interface ReflectionOptions {
  intensity: number;      // 0-1, controls opacity (default: 0.3)
  height: number;         // 0-1, fraction of subject height (default: 0.5)
  blur: number;          // 0-20, blur amount in pixels (default: 3)
  fadeStrength: number;  // 0-1, gradient fade intensity (default: 0.7)
  offset: number;        // pixels, gap between subject and reflection (default: 5)
}

const DEFAULT_OPTIONS: ReflectionOptions = {
  intensity: 0.3,
  height: 0.5,
  blur: 3,
  fadeStrength: 0.7,
  offset: 5
};

/**
 * Generate a reflection effect for a transparent subject image
 * Returns a new image with the subject and its reflection
 */
export const generateReflection = async (
  subjectDataUrl: string,
  options: Partial<ReflectionOptions> = {}
): Promise<string> => {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  return new Promise((resolve, reject) => {
    const img = new Image();
    
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        
        if (!ctx) {
          throw new Error('Could not get canvas context');
        }

        // Calculate reflection dimensions
        const reflectionHeight = Math.floor(img.height * opts.height);
        
        // Canvas height = subject + offset + reflection
        canvas.width = img.width;
        canvas.height = img.height + opts.offset + reflectionHeight;

        console.log('🪞 Generating reflection:', {
          subjectSize: `${img.width}x${img.height}`,
          reflectionHeight,
          totalCanvasHeight: canvas.height,
          options: opts
        });

        // 1. Draw the original subject at the top
        ctx.drawImage(img, 0, 0);

        // 2. Create reflection below
        ctx.save();
        
        // Move to position below subject (after offset)
        ctx.translate(0, img.height + opts.offset);
        
        // Flip vertically for reflection
        ctx.scale(1, -1);
        
        // Draw the reflected image (flipped)
        // Only draw the top portion based on height setting
        ctx.drawImage(
          img,
          0, 0, img.width, reflectionHeight,  // Source: top portion of image
          0, 0, img.width, reflectionHeight   // Destination: flipped below
        );
        
        ctx.restore();

        // 3. Apply fade gradient to reflection area
        const gradient = ctx.createLinearGradient(
          0,
          img.height + opts.offset,
          0,
          img.height + opts.offset + reflectionHeight
        );
        
        // Fade from semi-transparent to fully transparent
        gradient.addColorStop(0, `rgba(255, 255, 255, ${1 - opts.intensity})`);
        gradient.addColorStop(opts.fadeStrength, `rgba(255, 255, 255, ${1 - (opts.intensity * 0.3)})`);
        gradient.addColorStop(1, 'rgba(255, 255, 255, 1)');
        
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = gradient;
        ctx.fillRect(
          0,
          img.height + opts.offset,
          canvas.width,
          reflectionHeight
        );

        // 4. Apply blur to reflection area only (optional, can be expensive)
        if (opts.blur > 0) {
          // Get reflection area as image data
          const reflectionImageData = ctx.getImageData(
            0,
            img.height + opts.offset,
            canvas.width,
            reflectionHeight
          );
          
          // Create temporary canvas for blur
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = canvas.width;
          tempCanvas.height = reflectionHeight;
          const tempCtx = tempCanvas.getContext('2d');
          
          if (tempCtx) {
            tempCtx.putImageData(reflectionImageData, 0, 0);
            tempCtx.filter = `blur(${opts.blur}px)`;
            tempCtx.drawImage(tempCanvas, 0, 0);
            
            // Put blurred reflection back
            ctx.clearRect(0, img.height + opts.offset, canvas.width, reflectionHeight);
            ctx.globalCompositeOperation = 'source-over';
            ctx.drawImage(tempCanvas, 0, img.height + opts.offset);
          }
        }

        const result = canvas.toDataURL('image/png');
        console.log('✅ Reflection generated successfully');
        resolve(result);
        
      } catch (error) {
        console.error('Error generating reflection:', error);
        reject(error);
      }
    };
    
    img.onerror = () => {
      reject(new Error('Failed to load subject image for reflection'));
    };
    
    img.src = subjectDataUrl;
  });
};

/**
 * Generate reflections for multiple images in parallel
 */
export const generateReflections = async (
  images: Array<{ name: string; data: string }>,
  options: Partial<ReflectionOptions> = {}
): Promise<Array<{ name: string; reflectionData: string }>> => {
  console.log(`🪞 Generating reflections for ${images.length} images`);
  
  const reflectionPromises = images.map(async (image) => {
    const reflectionData = await generateReflection(image.data, options);
    return {
      name: image.name,
      reflectionData
    };
  });
  
  return Promise.all(reflectionPromises);
};
