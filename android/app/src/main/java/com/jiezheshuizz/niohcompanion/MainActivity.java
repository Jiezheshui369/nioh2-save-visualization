package com.jiezheshuizz.niohcompanion;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle state) {
        registerPlugin(LocalSyncPlugin.class);
        super.onCreate(state);
    }
}
