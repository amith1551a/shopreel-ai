/**
 * GET /api/config
 * Returns application configuration matching Flask's response
 */

export async function apiConfigRoute(req, res, next) {
  try {
    const config = {
      app: 'ShopReel AI',
      version: '2.0.0',
      backend: 'Node.js Express',
      models: [
        {
          provider: 'Higgsfield',
          id: 'wan-3.0',
          name: 'Wan 3.0 (Reference-to-Video)',
          type: 'reference-to-video',
          costPerSecond: 0.05,
          description: 'Fast, high-quality reference-to-video generation',
          default: true,
        },
        {
          provider: 'Higgsfield',
          id: 'kling-3.0',
          name: 'Kling 3.0 (Text-to-Video)',
          type: 'text-to-video',
          costPerSecond: 0.10,
          description: 'Text-to-video generation (requires additional approval)',
          default: false,
        },
      ],
      limits: {
        monthlyBudget: parseFloat(process.env.MONTHLY_BUDGET_USD || '20.00'),
        dailyBudget: parseFloat(process.env.DAILY_BUDGET_USD || '0.60'),
        jobBudget: parseFloat(process.env.JOB_BUDGET_USD || '0.25'),
        concurrentPaidJobs: 1,
        videoMinDuration: 5,
        videoMaxDuration: 30,
        imageMaxSize: 52428800, // 50 MB
        audioMaxSize: 104857600, // 100 MB
      },
      features: {
        imageUpload: true,
        scriptParsing: true,
        storyboardEditing: true,
        costPreview: true,
        videoGeneration: true,
        musicIntegration: true,
        captionGeneration: true,
        browserRendering: true,
        videoDownload: true,
      },
      currencies: ['USD'],
      timezone: 'America/Chicago',
      supportedFormats: {
        image: ['jpg', 'jpeg', 'png', 'webp'],
        audio: ['mp3', 'wav', 'aac'],
        video: ['mp4'],
      },
    };

    res.json(config);
  } catch (err) {
    next(err);
  }
}
