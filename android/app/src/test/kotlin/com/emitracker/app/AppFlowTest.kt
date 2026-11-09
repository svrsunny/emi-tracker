package com.emitracker.app

import androidx.activity.result.contract.ActivityResultContracts

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextReplacement
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * End-to-end UI flow on the real activity (Robolectric): onboarding, create a loan with the
 * wizard, record a payment, see the dashboard update, open the heatmap and save reminder
 * settings. Backup restore through the system file picker cannot be automated here; the restore
 * pipeline is covered by DataLayerTest.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w411dp-h891dp-xxhdpi")
class AppFlowTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()
    /**
     * The repository the UI writes through. (Robolectric reuses AndroidViewModelFactory's cached
     * Application across tests in one JVM, so read via the activity's ViewModel, not the Application.)
     */
    private val repo get() = androidx.lifecycle.ViewModelProvider(rule.activity)[com.emitracker.app.ui.AppViewModel::class.java].repo

    private fun waitText(text: String, timeout: Long = 30_000) =
        rule.waitUntil(timeout) { rule.onAllNodesWithText(text, substring = true).fetchSemanticsNodes().isNotEmpty() }

    /** Scroll the screen's lazy list until the node is actually on screen (taps are injected at its centre). */
    private fun scrollTo(matcher: SemanticsMatcher) {
        runCatching { rule.onAllNodes(hasScrollToNodeAction()).onFirst().performScrollToNode(matcher) }
        rule.waitForIdle()
    }

    private fun click(text: String) {
        val m = hasText(text) and hasClickAction()
        scrollTo(m)
        // invoke the node's click action directly: tall list items can extend past the screen edge
        rule.onAllNodes(m).onFirst().performSemanticsAction(SemanticsActions.OnClick)
        rule.waitForIdle()
    }

    private fun type(label: String, value: String) {
        val m = hasSetTextAction() and hasText(label, substring = true)
        scrollTo(m)
        rule.onAllNodes(m).onFirst().performTextReplacement(value)
        rule.waitForIdle()
    }

    @Test fun createLoanRecordPaymentHeatmapAndReminders() {
        waitText("Continue without notifications")
        click("Continue without notifications")
        waitText("Add your first loan")
        click("Add your first loan")

        // wizard: basics -> amount & rate -> schedule -> charges -> history -> reminders -> review
        waitText("Step 1 of 7")
        type("Loan name", "UI Test Loan")
        type("Lender / bank", "Test Bank")
        click("Continue")
        waitText("Step 2 of 7")
        type("Original principal", "500000")
        type("Annual interest rate", "9")
        click("Continue")
        waitText("Step 3 of 7")
        click("Continue")
        waitText("Step 4 of 7")
        click("Continue")
        waitText("Step 5 of 7")
        click("Continue")
        // reminders step: asked whether to remind, which days before, and the due dates
        waitText("Step 6 of 7")
        waitText("Do you want reminders for this loan")
        click("10 days before")
        waitText("Your next reminders")
        click("Continue")
        waitText("Calculated preview")
        waitText("day(s) before and on the due date")
        click("Create loan")
        rule.waitUntil(30_000) { repo.state.value.loans.any { it.name == "UI Test Loan" } }
        val created = repo.state.value.loans.single { it.name == "UI Test Loan" }
        assertTrue(created.reminderEnabled)
        assertTrue(10 in (created.reminderOffsets ?: emptyList()))

        // dashboard reflects the loan
        waitText("Outstanding principal")
        rule.onAllNodesWithText("Outstanding principal", substring = true).onFirst().assertExists()

        // record the first EMI from the loan's schedule
        click("Loans")
        waitText("UI Test Loan")
        rule.onAllNodesWithText("UI Test Loan").onFirst().performClick()
        waitText("Schedule (")
        rule.onAllNodesWithText("Schedule (", substring = true).onFirst().performClick()
        rule.waitForIdle()
        waitText("#1")
        rule.onAllNodesWithText("#1").onFirst().performClick()
        rule.waitForIdle()
        click("Record payment")
        waitText("Transaction date is tracked separately")
        click("Record")
        rule.waitUntil(30_000) { repo.state.value.payments.size == 1 }
        val p = repo.state.value.payments.single()
        assertEquals(1, p.installmentNo)
        assertEquals("advance", p.type)
        assertTrue(p.amount.toBigDecimal().signum() > 0)

        // heatmap opens and shows activity
        rule.runOnUiThread { rule.activity.onBackPressedDispatcher.onBackPressed() }
        rule.waitForIdle()
        // monthly expenses: this loan's first EMI is paid
        click("Expenses")
        waitText("Total for")
        // the loan's first EMI (paid in advance above) falls next month
        rule.onAllNodes(androidx.compose.ui.test.hasContentDescription("Next month")).onFirst().performSemanticsAction(SemanticsActions.OnClick)
        rule.waitForIdle()
        waitText("Where the money goes")
        waitText("Loan EMIs")
        // bills tab
        click("Bills")
        waitText("No bills yet")
        click("Add your first bill")
        waitText("Remind me about this bill?")
        type("Bill name", "Electricity")
        type("Amount", "1800")
        click("Add bill")
        rule.waitUntil(30_000) { repo.state.value.bills.any { it.name == "Electricity" } }
        waitText("Average per month")
        // a one-time expense dated today is recorded as already paid in the same step
        click("One-time")
        waitText("What for")
        waitText("Already paid")
        type("What for", "Car service")
        type("Amount", "4500")
        click("Add expense")
        rule.waitUntil(30_000) { repo.state.value.bills.any { it.name == "Car service" && it.frequency == "once" } }
        rule.waitUntil(30_000) { repo.state.value.billPayments.any { p -> repo.state.value.bills.any { it.id == p.billId && it.frequency == "once" } } }
        waitText("One-time expenses")
        // lending & borrowing lives under More
        click("More")
        click("Lending & borrowing")
        waitText("Nothing lent or borrowed yet")
        click("I lent money")
        type("Lent to", "Ravi")
        type("Amount", "10000")
        click("Add entry")
        rule.waitUntil(30_000) { repo.state.value.debts.any { it.person == "Ravi" && it.direction == "lent" } }
        waitText("You will get back")
        waitText("Got money back") // not opened here: Robolectric never idles with any AlertDialog open (the bill payment dialog hangs the same way)
        rule.runOnUiThread { rule.activity.onBackPressedDispatcher.onBackPressed() }
        rule.waitForIdle()
        // heatmaps now live under More
        click("Bills")
        click("More")
        click("Repayment heatmaps")
        waitText("Daily activity")
        waitText("day(s) with payments")

        // reminders: change and save settings (back to More: heatmaps is not a tab)
        rule.runOnUiThread { rule.activity.onBackPressedDispatcher.onBackPressed() }
        rule.waitForIdle()
        click("Reminders & notifications")
        // your own reminders come first, with an add button; no loan needed
        waitText("My reminders (0)")
        waitText("Add a reminder")
        waitText("It doesn't need a loan")
        waitText("Inbox (")
        rule.onAllNodesWithText("Settings").onFirst().performClick()
        rule.waitForIdle()
        assertTrue(repo.state.value.preferences.reminders.quietEnabled)
        click("Quiet hours")
        click("Save reminder settings")
        rule.waitUntil(30_000) { !repo.state.value.preferences.reminders.quietEnabled }
    }

    /** Every system picker the app uses must open from MainActivity (a FragmentActivity): with fragment 1.2.x they all crashed. */
    @Test fun filePickersOpenFromTheActivity() {
        rule.runOnUiThread {
            val registry = rule.activity.activityResultRegistry
            registry.register("test-tree", ActivityResultContracts.OpenDocumentTree()) {}.launch(null)
            registry.register("test-create", ActivityResultContracts.CreateDocument("application/json")) {}.launch("emi-tracker-backup.json")
            registry.register("test-open", ActivityResultContracts.OpenDocument()) {}.launch(arrayOf("*/*"))
        }
        rule.waitForIdle()
    }

    @Test fun onboardingExplainsPrivacy() {
        waitText("Works fully offline")
        rule.onNodeWithText("Stored only on this phone").assertExists()
    }
}
