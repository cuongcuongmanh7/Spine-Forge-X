//! Bounded-concurrency task scheduler shared by the batch-export and
//! clean-source runners. Both spawn one Tokio task per work item, cap how many
//! run at once with a semaphore, report completion order via an atomic counter,
//! and stop queueing new work once a Stop flag is set. `run_indexed` factors out
//! that boilerplate; callers keep their own per-item work and progress events.

use std::{
    future::Future,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    },
};
use tokio::{sync::Semaphore, task::JoinSet};

/// Handed to each task so it can report completion order for progress events.
pub(crate) struct Done(Arc<AtomicUsize>);

impl Done {
    /// Atomically record this task as finished and return the 1-based count of
    /// tasks finished so far — completion order across parallel tasks, not spawn
    /// order. Call once, on the path that actually did the work.
    pub(crate) fn tick(&self) -> usize {
        self.0.fetch_add(1, Ordering::SeqCst) + 1
    }
}

/// Run `task` over `items` with at most `parallel` concurrent tasks.
///
/// Each task receives its original index, the item, and a [`Done`] token (for
/// reporting completion order in progress events). Items not yet started when
/// `stop` is set are never queued — the loop breaks. A task that has already
/// started is left to finish and may re-check `stop` itself. Returns
/// `(index, output)` pairs in completion order; callers reorder by index if they
/// need the original order. Panicked/cancelled tasks are dropped from the result.
pub(crate) async fn run_indexed<T, R, F, Fut>(
    items: Vec<T>,
    parallel: usize,
    stop: &AtomicBool,
    task: F,
) -> Vec<(usize, R)>
where
    T: Send + 'static,
    R: Send + 'static,
    F: Fn(usize, T, Done) -> Fut,
    Fut: Future<Output = R> + Send + 'static,
{
    let semaphore = Arc::new(Semaphore::new(parallel.max(1)));
    let completed = Arc::new(AtomicUsize::new(0));
    let mut join_set: JoinSet<(usize, R)> = JoinSet::new();

    for (index, item) in items.into_iter().enumerate() {
        // Check the stop flag BEFORE queuing so a Stop request drains the queue
        // immediately instead of spawning every remaining unit.
        if stop.load(Ordering::SeqCst) {
            break;
        }
        let sem = Arc::clone(&semaphore);
        let done = Done(Arc::clone(&completed));
        let fut = task(index, item, done);
        join_set.spawn(async move {
            // Acquire a permit — blocks while `parallel` tasks already run. Held
            // for the lifetime of the work and released on drop.
            let _permit = sem.acquire().await;
            (index, fut.await)
        });
    }

    let mut results = Vec::new();
    while let Some(joined) = join_set.join_next().await {
        if let Ok(pair) = joined {
            results.push(pair);
        }
    }
    results
}
