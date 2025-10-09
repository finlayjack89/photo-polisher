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
  intensity: 0.45,   // 45% opacity (more visible)
  height: 0.7,       // 70% of subject height (more recognizable)
  blur: 3,           // 3px blur (preserve details)
  fadeStrength: 0.85, // 85% fade (strong fade toward bottom)
  offset: 0          // 0px gap (reflection starts immediately at surface)
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
        
        // Canvas contains ONLY the reflection (not subject)
        canvas.width = img.width;
        canvas.height = reflectionHeight;

        console.log('🪞 Generating reflection:', {
          subjectSize: `${img.width}x${img.height}`,
          reflectionHeight,
          reflectionCanvasHeight: canvas.height,
          options: opts
        });

        // Create vertically flipped reflection (upside down)
        ctx.save();
        
        // Flip vertically for proper reflection (upside down)
        ctx.scale(1, -1);
        ctx.translate(0, -reflectionHeight);
        
        // Draw the reflection - take from BOTTOM of image and flip it
        // For a 70% reflection, we want the bottom 70% of the bag reflected
        const sourceStartY = img.height * (1 - opts.height);
        ctx.drawImage(
          img,
          0, sourceStartY, img.width, img.height * opts.height,  // Source: bottom portion of bag
          0, 0, img.width, reflectionHeight                       // Destination: flipped upside down
        );
        
        ctx.restore();

        // Apply fade gradient to create realistic reflection fade
        const gradient = ctx.createLinearGradient(
          0,
          0,
          0,
          reflectionHeight
        );
        
        // Fade from more visible at top to fully transparent at bottom
        gradient.addColorStop(0, `rgba(255, 255, 255, ${1 - opts.intensity})`); // Start at 45% opacity
        gradient.addColorStop(opts.fadeStrength * 0.5, `rgba(255, 255, 255, ${1 - (opts.intensity * 0.5)})`); // Mid-fade
        gradient.addColorStop(opts.fadeStrength, `rgba(255, 255, 255, ${1 - (opts.intensity * 0.2)})`); // Near bottom
        gradient.addColorStop(1, 'rgba(255, 255, 255, 1)'); // Fully transparent at bottom
        
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = gradient;
        ctx.fillRect(
          0,
          0,
          canvas.width,
          reflectionHeight
        );

        // Apply blur to reflection for realism
        if (opts.blur > 0) {
          // Get reflection as image data
          const reflectionImageData = ctx.getImageData(
            0,
            0,
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
            ctx.clearRect(0, 0, canvas.width, reflectionHeight);
            ctx.globalCompositeOperation = 'source-over';
            ctx.drawImage(tempCanvas, 0, 0);
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
