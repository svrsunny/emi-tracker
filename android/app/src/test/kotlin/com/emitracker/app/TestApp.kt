package com.emitracker.app

import androidx.work.Configuration
import androidx.work.testing.SynchronousExecutor
import androidx.work.testing.WorkManagerTestInitHelper

/** Application used under Robolectric: identical to the real app, but with the test WorkManager. */
class TestApp : EmiApp() {
    override fun startBackground() {
        WorkManagerTestInitHelper.initializeTestWorkManager(this, Configuration.Builder().setExecutor(SynchronousExecutor()).build())
    }
}
