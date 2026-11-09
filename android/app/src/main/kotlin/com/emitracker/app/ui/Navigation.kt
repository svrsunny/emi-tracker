package com.emitracker.app.ui

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.AccountBalance
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material.icons.outlined.PieChart
import androidx.compose.material.icons.outlined.Receipt
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material.icons.outlined.WifiOff
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.emitracker.app.ui.components.Callout
import com.emitracker.app.ui.components.CalloutKind
import com.emitracker.app.ui.screens.BackupScreen
import com.emitracker.app.ui.screens.BillFormScreen
import com.emitracker.app.ui.screens.BillsScreen
import com.emitracker.app.ui.screens.LendingScreen
import com.emitracker.app.ui.screens.DebtFormScreen
import com.emitracker.app.ui.screens.ExpensesScreen
import com.emitracker.app.ui.screens.CalendarScreen
import com.emitracker.app.ui.screens.DashboardScreen
import com.emitracker.app.ui.screens.HeatmapScreen
import com.emitracker.app.ui.screens.HelpScreen
import com.emitracker.app.ui.screens.LoanDetailScreen
import com.emitracker.app.ui.screens.LoanWizardScreen
import com.emitracker.app.ui.screens.LoansScreen
import com.emitracker.app.ui.screens.MoreScreen
import com.emitracker.app.ui.screens.PaymentFormScreen
import com.emitracker.app.ui.screens.PaymentsScreen
import com.emitracker.app.ui.screens.RemindersScreen
import com.emitracker.app.ui.screens.ReportsScreen
import com.emitracker.app.ui.screens.SchedulesScreen
import com.emitracker.app.ui.screens.SettingsScreen
import com.emitracker.app.ui.screens.WhatIfScreen
import com.emitracker.app.work.Background

private data class Tab(val route: String, val label: String, val icon: ImageVector)
private val TABS = listOf(
    Tab("dashboard", "Dashboard", Icons.Outlined.Dashboard), Tab("loans", "Loans", Icons.Outlined.AccountBalance),
    Tab("bills", "Bills", Icons.Outlined.Receipt), Tab("expenses", "Expenses", Icons.Outlined.PieChart), Tab("more", "More", Icons.Outlined.MoreHoriz),
)

@Composable
fun AppRoot(vm: AppViewModel, deepLink: String?) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val ready by vm.ready.collectAsStateWithLifecycle()
    val p = LocalPalette.current
    val lockReady by com.emitracker.app.security.AppLock.ready.collectAsStateWithLifecycle()
    val locked by com.emitracker.app.security.AppLock.locked.collectAsStateWithLifecycle()
    if (!ready || !lockReady) { Box(Modifier.fillMaxSize().background(p.bg)); return }
    if (locked) { LockScreen(vm, ui.data.local); return }
    if (!ui.data.local.onboardingDone) { Onboarding(vm); return }

    val nav = rememberNavController()
    val snack = remember { SnackbarHostState() }
    LaunchedEffect(Unit) {
        vm.messages.collect { m ->
            when (m) {
                is Msg.Info -> snack.showSnackbar(m.text, duration = SnackbarDuration.Short)
                is Msg.Error -> snack.showSnackbar(m.text, withDismissAction = true, duration = SnackbarDuration.Long)
            }
        }
    }
    val pending by vm.pendingRoute.collectAsStateWithLifecycle()
    LaunchedEffect(deepLink, pending) {
        val target = pending ?: deepLink
        if (target != null) { navigateDeep(nav, target); vm.pendingRoute.value = null }
    }
    val backStack by nav.currentBackStackEntryAsState()
    // routes may carry optional arguments ("heatmaps?date={date}"); tabs match on the base route
    val current = backStack?.destination?.route?.substringBefore('?') ?: "dashboard"
    val overdue = ui.data.loans.filter { it.status == "active" }.sumOf { ui.comps[it.id]?.summary?.overdueCount ?: 0 }

    Scaffold(
        containerColor = p.bg,
        snackbarHost = { SnackbarHost(snack) },
        bottomBar = {
            if (TABS.any { it.route == current }) {
                NavigationBar(containerColor = p.bg2, tonalElevation = 0.dp) {
                    TABS.forEach { t ->
                        NavigationBarItem(
                            selected = current == t.route,
                            onClick = { nav.navigate(t.route) { popUpTo("dashboard") { saveState = true }; launchSingleTop = true; restoreState = true } },
                            icon = {
                                when {
                                    t.route == "loans" && overdue > 0 -> BadgedBox(badge = { Badge(containerColor = p.danger) { Text("$overdue") } }) { Icon(t.icon, null) }
                                    t.route == "more" && ui.inbox.isNotEmpty() -> BadgedBox(badge = { Badge(containerColor = p.info) { Text("${ui.inbox.size}") } }) { Icon(t.icon, null) }
                                    else -> Icon(t.icon, null)
                                }
                            },
                            label = { Text(t.label) },
                            colors = NavigationBarItemDefaults.colors(indicatorColor = p.accent.copy(alpha = 0.18f), selectedIconColor = p.accent, selectedTextColor = p.text, unselectedIconColor = p.text3, unselectedTextColor = p.text3),
                        )
                    }
                }
            }
        },
    ) { pad ->
        NavHost(nav, startDestination = "dashboard", modifier = Modifier.padding(bottom = pad.calculateBottomPadding())) {
            composable("dashboard") { DashboardScreen(vm, nav) }
            composable("loans") { LoansScreen(vm, nav) }
            composable("heatmaps?date={date}", arguments = listOf(navArgument("date") { nullable = true })) { HeatmapScreen(vm, nav, it.arguments?.getString("date")) }
            composable("calendar") { CalendarScreen(vm, nav) }
            composable("more") { MoreScreen(vm, nav) }
            composable("bills") { BillsScreen(vm, nav) }
            composable("expenses") { ExpensesScreen(vm, nav) }
            composable("bill?id={id}&once={once}", arguments = listOf(navArgument("id") { nullable = true }, navArgument("once") { type = androidx.navigation.NavType.BoolType; defaultValue = false })) {
                BillFormScreen(vm, nav, it.arguments?.getString("id"), it.arguments?.getBoolean("once") ?: false)
            }
            composable("lending") { LendingScreen(vm, nav) }
            composable("debt?id={id}&dir={dir}", arguments = listOf(navArgument("id") { nullable = true }, navArgument("dir") { defaultValue = "lent" })) {
                DebtFormScreen(vm, nav, it.arguments?.getString("id"), it.arguments?.getString("dir") ?: "lent")
            }
            composable("loan/{id}") { LoanDetailScreen(vm, nav, it.arguments?.getString("id") ?: "") }
            composable("wizard?id={id}", arguments = listOf(navArgument("id") { nullable = true })) { LoanWizardScreen(vm, nav, it.arguments?.getString("id")) }
            composable("payment?loanId={loanId}&inst={inst}&type={type}&edit={edit}", arguments = listOf(
                navArgument("loanId") { nullable = true }, navArgument("inst") { type = NavType.IntType; defaultValue = -1 },
                navArgument("type") { nullable = true }, navArgument("edit") { nullable = true },
            )) { PaymentFormScreen(vm, nav, it.arguments?.getString("loanId"), it.arguments?.getInt("inst")?.takeIf { n -> n > 0 }, it.arguments?.getString("type"), it.arguments?.getString("edit")) }
            composable("payments?loan={loan}&month={month}&date={date}", arguments = listOf(navArgument("loan") { nullable = true }, navArgument("month") { nullable = true }, navArgument("date") { nullable = true })) {
                PaymentsScreen(vm, nav, it.arguments?.getString("loan"), it.arguments?.getString("month"), it.arguments?.getString("date"))
            }
            composable("schedules?loan={loan}", arguments = listOf(navArgument("loan") { nullable = true })) { SchedulesScreen(vm, nav, it.arguments?.getString("loan")) }
            composable("whatif") { WhatIfScreen(vm, nav) }
            composable("reminders") { RemindersScreen(vm, nav) }
            composable("reports") { ReportsScreen(vm, nav) }
            composable("backup") { BackupScreen(vm, nav) }
            composable("settings") { SettingsScreen(vm, nav) }
            composable("help") { HelpScreen(vm, nav) }
        }
    }
}

private fun navigateDeep(nav: NavHostController, target: String) {
    when {
        target.startsWith("loan/") -> nav.navigate(target)
        target.startsWith("reminders") -> nav.navigate("reminders")
    }
}

/** First-run: what the app does with data, and an explained notification permission request. */
@Composable
private fun Onboarding(vm: AppViewModel) {
    val p = LocalPalette.current
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        vm.act { vm.repo.setLocal { it.copy(notificationPrompted = true, onboardingDone = true) } }
        if (!granted) vm.info("Reminders will appear in the app inbox. You can allow notifications later in Settings.")
    }
    Column(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(p.accent.copy(alpha = 0.14f), p.bg, p.bg))).statusBarsPadding().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Spacer(Modifier.height(24.dp))
        Box(Modifier.size(56.dp).clip(RoundedCornerShape(16.dp)).background(Brush.linearGradient(listOf(p.accent, androidx.compose.ui.graphics.Color(0xFF6D3AE0)))), contentAlignment = Alignment.Center) {
            Icon(Icons.Outlined.AccountBalance, null, tint = androidx.compose.ui.graphics.Color.White)
        }
        Text("EMI Tracker", style = MaterialTheme.typography.displaySmall, color = p.text, modifier = Modifier.semantics { heading() })
        Text("A private ledger for every loan you repay — what you've paid, what remains and when each loan closes.", style = MaterialTheme.typography.bodyLarge, color = p.text2)
        Feature(Icons.Outlined.WifiOff, "Works fully offline", "No accounts, ads, analytics or cloud. Nothing is sent to the internet — optional Wi-Fi sync talks only to your own PC at home.")
        Feature(Icons.Outlined.Lock, "Stored only on this phone", "Your data stays in the app's private storage. Back up to a folder you choose, optionally encrypted.")
        Feature(Icons.Outlined.NotificationsActive, "EMI reminders", "To remind you before EMIs are due, Android needs your permission to show notifications.")
        Callout("Android may delay background reminders to save battery. Anything missed is shown in the app and delivered late — never silently dropped.", CalloutKind.Info)
        Spacer(Modifier.height(8.dp))
        Button(onClick = {
            if (Build.VERSION.SDK_INT >= 33) ask.launch(Manifest.permission.POST_NOTIFICATIONS)
            else vm.act { vm.repo.setLocal { it.copy(onboardingDone = true, notificationPrompted = true) } }
        }, modifier = Modifier.fillMaxWidth().height(50.dp)) { Text(if (Build.VERSION.SDK_INT >= 33) "Allow reminders & continue" else "Get started") }
        TextButton(onClick = { vm.act { vm.repo.setLocal { it.copy(onboardingDone = true) } } }, modifier = Modifier.fillMaxWidth()) { Text("Continue without notifications", color = p.text2) }
    }
}

@Composable
private fun Feature(icon: ImageVector, title: String, text: String) {
    val p = LocalPalette.current
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(p.surface).padding(14.dp)) {
        Icon(icon, null, tint = p.accent)
        Column(Modifier.padding(start = 12.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall, color = p.text)
            Text(text, style = MaterialTheme.typography.bodySmall, color = p.text2)
        }
    }
}

/** Standard screen: title bar + lazy content, max width for tablets. */
@Composable
fun Screen(title: String, sub: String? = null, nav: NavHostController? = null, back: Boolean = false, actions: @Composable () -> Unit = {}, content: LazyListScope.() -> Unit) {
    val p = LocalPalette.current
    Column(Modifier.fillMaxSize().background(p.bg).statusBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(start = if (back) 4.dp else 18.dp, end = 8.dp, top = 8.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            if (back && nav != null) IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Back", tint = p.text) }
            Column(Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.headlineSmall, color = p.text, maxLines = 1, modifier = Modifier.semantics { heading() })
                sub?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = p.text3, maxLines = 1) }
            }
            actions()
        }
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
            LazyColumn(Modifier.widthIn(max = 840.dp).fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 6.dp, bottom = 32.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp), content = content)
        }
    }
}

/** Convenience used after changes that affect reminders. */
fun replan(vm: AppViewModel) = Background.runSoon(vm.getApplication())
