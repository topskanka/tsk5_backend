/**
 * Memory monitoring utility to track and optimize RAM usage
 */

class MemoryMonitor {
  constructor() {
    this.startTime = Date.now();
    this.initialMemory = process.memoryUsage();
    this.checkpoints = [];
  }

  /**
   * Get current memory usage
   */
  getCurrentUsage() {
    const usage = process.memoryUsage();
    return {
      rss: Math.round(usage.rss / 1024 / 1024), // MB
      heapUsed: Math.round(usage.heapUsed / 1024 / 1024), // MB
      heapTotal: Math.round(usage.heapTotal / 1024 / 1024), // MB
      external: Math.round(usage.external / 1024 / 1024), // MB
      arrayBuffers: Math.round(usage.arrayBuffers / 1024 / 1024) // MB
    };
  }

  /**
   * Create a memory checkpoint
   */
  checkpoint(label) {
    const usage = this.getCurrentUsage();
    const checkpoint = {
      label,
      timestamp: Date.now(),
      usage,
      timeSinceStart: Date.now() - this.startTime
    };
    
    this.checkpoints.push(checkpoint);
    return checkpoint;
  }

  /**
   * Get memory usage report
   */
  getReport() {
    const current = this.getCurrentUsage();
    const initial = {
      rss: Math.round(this.initialMemory.rss / 1024 / 1024),
      heapUsed: Math.round(this.initialMemory.heapUsed / 1024 / 1024),
      heapTotal: Math.round(this.initialMemory.heapTotal / 1024 / 1024)
    };

    return {
      initial,
      current,
      difference: {
        rss: current.rss - initial.rss,
        heapUsed: current.heapUsed - initial.heapUsed,
        heapTotal: current.heapTotal - initial.heapTotal
      },
      checkpoints: this.checkpoints,
      uptime: Date.now() - this.startTime
    };
  }

  /**
   * Force garbage collection if available
   */
  forceGC() {
    if (global.gc) {
      global.gc();
      return true;
    }
    return false;
  }

  /**
   * Log memory usage with optional label
   */
  log(label = 'Memory Usage') {
    const usage = this.getCurrentUsage();
    console.log(`[${label}] RSS: ${usage.rss}MB, Heap: ${usage.heapUsed}/${usage.heapTotal}MB`);
  }

  /**
   * Check if memory usage is above threshold
   */
  isMemoryHigh(thresholdMB = 500) {
    const usage = this.getCurrentUsage();
    return usage.rss > thresholdMB;
  }
}

// Create singleton instance
const memoryMonitor = new MemoryMonitor();

// Log memory usage every 5 minutes in development
if (process.env.NODE_ENV === 'development') {
  setInterval(() => {
    memoryMonitor.log('Periodic Check');
  }, 300000);
}

module.exports = memoryMonitor;
