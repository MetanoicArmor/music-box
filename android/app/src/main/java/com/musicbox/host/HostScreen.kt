package com.musicbox.host

import android.graphics.Bitmap
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.QrCode2
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Wifi
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView

private val Accent = Color(0xFFFA2D48)
private val Bg = Color(0xFF000000)
private val Card = Color(0xFF1C1C1E)
private val TextPri = Color(0xFFF5F5F7)
private val TextSec = Color(0x99EBEBF5)

@Composable
fun MusicBoxTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Accent,
            background = Bg,
            surface = Card,
            onPrimary = Color.White,
            onBackground = TextPri,
            onSurface = TextPri,
        ),
        content = content,
    )
}

private val LogoPartyColors = listOf(
    Color(0xFFFF2D55),
    Color(0xFFFFCC00),
    Color(0xFF30D158),
    Color(0xFF64D2FF),
    Color(0xFF0A84FF),
    Color(0xFFBF5AF2),
)

@Composable
private fun PartyLogo() {
    Text(
        "Music Box",
        style = TextStyle(
            fontSize = MaterialTheme.typography.headlineMedium.fontSize,
            fontWeight = FontWeight.Bold,
            letterSpacing = MaterialTheme.typography.headlineMedium.letterSpacing,
            brush = Brush.linearGradient(LogoPartyColors),
        ),
    )
}

@Composable
fun HostApp(
    state: HostUiState,
    runtime: HostRuntime,
    onStart: () -> Unit,
    onStop: () -> Unit,
    onOpenSystemHotspot: () -> Unit = {},
) {
    var tab by remember { mutableIntStateOf(0) }
    Scaffold(
        containerColor = Bg,
        bottomBar = {
            NavigationBar(containerColor = Card) {
                NavigationBarItem(
                    selected = tab == 0,
                    onClick = { tab = 0 },
                    icon = { Icon(Icons.Default.Wifi, contentDescription = null) },
                    label = { Text(stringResource(R.string.tab_host)) },
                )
                NavigationBarItem(
                    selected = tab == 1,
                    onClick = { tab = 1 },
                    icon = { Icon(Icons.Default.PlayArrow, contentDescription = null) },
                    label = { Text(stringResource(R.string.tab_player)) },
                )
                NavigationBarItem(
                    selected = tab == 2,
                    onClick = { tab = 2 },
                    icon = { Icon(Icons.Default.Settings, contentDescription = null) },
                    label = { Text(stringResource(R.string.tab_settings)) },
                )
            }
        },
    ) { padding ->
        when (tab) {
            0 -> HostTab(state, onStart, onStop, { runtime.startHotspot() }, onOpenSystemHotspot, Modifier.padding(padding))
            1 -> PlayerTab(state, Modifier.padding(padding))
            else -> SettingsTab(runtime, Modifier.padding(padding))
        }
    }
}

@Composable
private fun LangSwitchRow() {
    val context = LocalContext.current
    val activity = HostLocale.findActivity(context)
    val lang = HostLocale.current(context)
    val label = stringResource(R.string.lang_switch)
    Row(
        modifier = Modifier
            .background(Card, RoundedCornerShape(999.dp))
            .padding(horizontal = 10.dp, vertical = 6.dp)
            .semantics(mergeDescendants = true) {
                contentDescription = label
            },
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            "Ru",
            color = if (lang == "ru") Accent else TextSec,
            fontWeight = if (lang == "ru") FontWeight.SemiBold else FontWeight.Normal,
            modifier = Modifier.clickable(enabled = lang != "ru" && activity != null) {
                activity?.let { HostLocale.set(it, "ru") }
            },
        )
        Text("|", color = TextSec)
        Text(
            "En",
            color = if (lang == "en") Accent else TextSec,
            fontWeight = if (lang == "en") FontWeight.SemiBold else FontWeight.Normal,
            modifier = Modifier.clickable(enabled = lang != "en" && activity != null) {
                activity?.let { HostLocale.set(it, "en") }
            },
        )
    }
}

@Composable
private fun HostTab(
    state: HostUiState,
    onStart: () -> Unit,
    onStop: () -> Unit,
    onHotspot: () -> Unit,
    onOpenSystemHotspot: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val qr: Bitmap? = remember(state.publicUrl) {
        state.publicUrl.takeIf { it.isNotBlank() }?.let { makeQrBitmap(it) }
    }
    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            PartyLogo()
            LangSwitchRow()
        }
        Text(
            if (state.running) stringResource(R.string.host_running_hint) else stringResource(R.string.host_idle_hint),
            color = TextSec,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            if (state.running) {
                Button(
                    onClick = onStop,
                    colors = ButtonDefaults.buttonColors(containerColor = Accent),
                ) {
                    Icon(Icons.Default.Stop, contentDescription = null)
                    Text("  ${stringResource(R.string.action_stop)}")
                }
            } else {
                Button(
                    onClick = onStart,
                    colors = ButtonDefaults.buttonColors(containerColor = Accent),
                ) {
                    Icon(Icons.Default.PlayArrow, contentDescription = null)
                    Text("  ${stringResource(R.string.action_start)}")
                }
            }
            TextButton(onClick = onHotspot) {
                Icon(Icons.Default.Wifi, contentDescription = null)
                Text("  ${stringResource(R.string.action_hotspot)}")
            }
        }
        InfoCard(stringResource(R.string.music_folder), "${state.mediaFolderUsb}\n${state.mediaFolder}")
        Text(stringResource(R.string.usb_hint), color = TextSec)
        if (state.error != null) {
            Text(state.error, color = Accent)
            if (state.error.contains("hotspot", ignoreCase = true) || state.error.contains("SoftAP")) {
                TextButton(onClick = onOpenSystemHotspot) {
                    Text(stringResource(R.string.open_system_hotspot))
                }
            }
        }
        if (state.running) {
            InfoCard(stringResource(R.string.guests), state.publicUrl)
            InfoCard(stringResource(R.string.lan_ip), "${state.lanIp}:${state.port}")
            if (state.currentTitle.isNotBlank()) {
                InfoCard(stringResource(R.string.now_playing), "${state.currentArtist} — ${state.currentTitle}")
            }
            if (state.hotspotSsid != null) {
                InfoCard(
                    stringResource(R.string.hotspot_label),
                    "${state.hotspotSsid}\n${stringResource(R.string.hotspot_password, state.hotspotPassword ?: "—")}",
                )
            }
            if (qr != null) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Color.White, RoundedCornerShape(16.dp))
                        .padding(16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Icon(Icons.Default.QrCode2, contentDescription = null, tint = Color.Black)
                    Spacer(Modifier.height(8.dp))
                    Image(bitmap = qr.asImageBitmap(), contentDescription = "QR", modifier = Modifier.size(240.dp))
                    Text(
                        if (state.https) stringResource(R.string.qr_https) else stringResource(R.string.qr_http),
                        color = Color.DarkGray,
                    )
                }
            }
            if (state.https) {
                Text(stringResource(R.string.guest_cert_hint), color = TextSec)
            }
        }
    }
}

@Composable
private fun InfoCard(label: String, value: String) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(Card, RoundedCornerShape(14.dp))
            .padding(14.dp),
    ) {
        Text(label, color = TextSec)
        Text(value, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun PlayerTab(state: HostUiState, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val activity = HostLocale.findActivity(context) ?: return
    val scheme = if (state.https) "https" else "http"
    val lang = HostLocale.current(context)
    val localUrl = if (state.running) "$scheme://127.0.0.1:${state.port}/?host=1&lang=$lang" else ""
    if (!state.running) {
        Column(modifier.padding(24.dp)) {
            Text(stringResource(R.string.start_host_first), color = TextSec)
        }
        return
    }
    AndroidView(
        modifier = modifier.fillMaxSize(),
        factory = { createGuestWebView(activity, localUrl) },
        update = { web: WebView ->
            if (web.url.isNullOrBlank() && localUrl.isNotBlank()) web.loadUrl(localUrl)
        },
    )
}

@Composable
private fun SettingsTab(runtime: HostRuntime, modifier: Modifier = Modifier) {
    val stored = remember { runtime.configStore.load() }
    var port by remember { mutableStateOf(stored.port.toString()) }
    var password by remember { mutableStateOf(stored.adminPassword) }
    var kick by remember { mutableStateOf(stored.kickThreshold.toString()) }
    var playingKick by remember { mutableStateOf(stored.playingKickDislikes.toString()) }
    var voteLimit by remember { mutableStateOf(stored.voteRateLimit.toString()) }
    var voteWindow by remember { mutableStateOf(stored.voteRateWindowSec.toString()) }
    var maxMb by remember { mutableStateOf(stored.maxUploadMb.toString()) }
    var maxMin by remember { mutableStateOf(stored.maxTrackMinutes.toString()) }
    var saved by remember { mutableStateOf(false) }

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(stringResource(R.string.settings_title), style = MaterialTheme.typography.titleLarge)
            LangSwitchRow()
        }
        InfoCard(stringResource(R.string.music_folder), "${runtime.paths.usbHint}\n${runtime.paths.media.absolutePath}")
        Text(stringResource(R.string.settings_usb_hint), color = TextSec)
        Text(stringResource(R.string.settings_restart_hint), color = TextSec)
        Field(stringResource(R.string.field_port), port, KeyboardType.Number) { port = it }
        OutlinedTextField(
            value = password,
            onValueChange = { password = it; saved = false },
            label = { Text(stringResource(R.string.field_admin_password)) },
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth(),
        )
        Field(stringResource(R.string.field_kick), kick, KeyboardType.Number) { kick = it }
        Field(stringResource(R.string.field_playing_kick), playingKick, KeyboardType.Number) { playingKick = it }
        Field(stringResource(R.string.field_vote_limit), voteLimit, KeyboardType.Number) { voteLimit = it }
        Field(stringResource(R.string.field_vote_window), voteWindow, KeyboardType.Number) { voteWindow = it }
        Field(stringResource(R.string.field_max_upload), maxMb, KeyboardType.Number) { maxMb = it }
        Field(stringResource(R.string.field_max_duration), maxMin, KeyboardType.Number) { maxMin = it }
        Button(
            onClick = {
                runtime.saveConfig(
                    AppConfig(
                        port = port.toIntOrNull() ?: 3000,
                        adminPassword = password,
                        kickThreshold = kick.toIntOrNull() ?: -2,
                        playingKickDislikes = playingKick.toIntOrNull() ?: 3,
                        voteRateLimit = voteLimit.toIntOrNull() ?: 10,
                        voteRateWindowSec = voteWindow.toIntOrNull() ?: 30,
                        maxUploadMb = maxMb.toIntOrNull() ?: 100,
                        maxTrackMinutes = maxMin.toIntOrNull() ?: 10,
                        eventMode = stored.eventMode,
                    ),
                )
                saved = true
            },
            colors = ButtonDefaults.buttonColors(containerColor = Accent),
        ) { Text(stringResource(R.string.action_save)) }
        if (saved) Text(stringResource(R.string.saved), color = Color(0xFF30D158))
    }
}

@Composable
private fun Field(label: String, value: String, type: KeyboardType, onChange: (String) -> Unit) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(label) },
        keyboardOptions = KeyboardOptions(keyboardType = type),
        modifier = Modifier.fillMaxWidth(),
        singleLine = true,
    )
}
