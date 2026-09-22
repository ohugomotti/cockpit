param(
  [Parameter(Mandatory = $true)]
  [ValidateRange(1, 2147483647)]
  [int]$ProcessId,
  [switch]$IncludeHidden
)

# Somente leitura: não muda atalhos, propriedades de janela ou cache do Windows.
$ErrorActionPreference = 'Stop'
$targetProcess = Get-Process -Id $ProcessId -ErrorAction Stop

if (-not ('CockpitTaskbarProperties.Reader' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace CockpitTaskbarProperties {
    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    public struct PropertyKey {
        public Guid FormatId;
        public uint PropertyId;
        public PropertyKey(uint id) {
            FormatId = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
            PropertyId = id;
        }
    }

    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPropertyStore {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int GetAt(uint index, out PropertyKey key);
        [PreserveSig] int GetValue(ref PropertyKey key, IntPtr value);
        [PreserveSig] int SetValue(ref PropertyKey key, IntPtr value);
        [PreserveSig] int Commit();
    }

    public sealed class WindowProperties {
        public long handle;
        public string title;
        public Dictionary<string, string> properties = new Dictionary<string, string>();
        public Dictionary<string, string> errors = new Dictionary<string, string>();
    }

    public static class Reader {
        private delegate bool EnumWindowsCallback(IntPtr window, IntPtr argument);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr argument);
        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool IsWindowVisible(IntPtr window);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetWindowText(IntPtr window, StringBuilder title, int maximum);
        [DllImport("shell32.dll", PreserveSig = true)]
        private static extern int SHGetPropertyStoreForWindow(
            IntPtr window, ref Guid interfaceId,
            [MarshalAs(UnmanagedType.Interface)] out IPropertyStore store);
        [DllImport("ole32.dll", PreserveSig = true)]
        private static extern int PropVariantClear(IntPtr value);

        private static string ReadString(IPropertyStore store, uint propertyId) {
            // PROPVARIANT tem 24 bytes no x64 e 16 no x86; o valor começa no offset 8.
            int size = IntPtr.Size == 8 ? 24 : 16;
            IntPtr variant = Marshal.AllocHGlobal(size);
            for (int i = 0; i < size; ++i) Marshal.WriteByte(variant, i, 0);
            try {
                var key = new PropertyKey(propertyId);
                Marshal.ThrowExceptionForHR(store.GetValue(ref key, variant));
                ushort type = unchecked((ushort)Marshal.ReadInt16(variant));
                if (type == 0 || type == 1) return null; // VT_EMPTY / VT_NULL: não definido.
                IntPtr text = Marshal.ReadIntPtr(variant, 8);
                if (type == 31) return Marshal.PtrToStringUni(text); // VT_LPWSTR
                if (type == 8) return text == IntPtr.Zero ? null : Marshal.PtrToStringBSTR(text);
                if (type == 30) return Marshal.PtrToStringAnsi(text); // VT_LPSTR
                throw new InvalidOperationException("Tipo PROPVARIANT inesperado: " + type);
            } finally {
                try { PropVariantClear(variant); }
                finally { Marshal.FreeHGlobal(variant); }
            }
        }

        private static WindowProperties ReadWindow(IntPtr window) {
            var title = new StringBuilder(2048);
            GetWindowText(window, title, title.Capacity);
            var result = new WindowProperties { handle = window.ToInt64(), title = title.ToString() };
            IPropertyStore store = null;
            try {
                Guid interfaceId = typeof(IPropertyStore).GUID;
                Marshal.ThrowExceptionForHR(SHGetPropertyStoreForWindow(window, ref interfaceId, out store));
                string[] names = {
                    "System.AppUserModel.ID", "System.AppUserModel.RelaunchIconResource",
                    "System.AppUserModel.RelaunchCommand", "System.AppUserModel.RelaunchDisplayNameResource"
                };
                uint[] ids = { 5, 3, 2, 4 };
                for (int i = 0; i < names.Length; ++i) {
                    try { result.properties[names[i]] = ReadString(store, ids[i]); }
                    catch (Exception ex) { result.errors[names[i]] = ex.Message; }
                }
            } catch (Exception ex) {
                result.errors["propertyStore"] = ex.Message;
            } finally {
                if (store != null && Marshal.IsComObject(store)) Marshal.FinalReleaseComObject(store);
            }
            return result;
        }

        public static WindowProperties[] Read(uint processId, bool includeHidden) {
            var windows = new List<WindowProperties>();
            EnumWindowsCallback callback = delegate(IntPtr window, IntPtr argument) {
                uint owner;
                GetWindowThreadProcessId(window, out owner);
                if (owner == processId && (includeHidden || IsWindowVisible(window))) windows.Add(ReadWindow(window));
                return true;
            };
            if (!EnumWindows(callback, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());
            GC.KeepAlive(callback);
            return windows.ToArray();
        }
    }
}
'@
}

[ordered]@{
  at = [DateTime]::UtcNow.ToString('o')
  processId = $ProcessId
  processName = $targetProcess.ProcessName
  windows = @([CockpitTaskbarProperties.Reader]::Read([uint32]$ProcessId, [bool]$IncludeHidden))
} | ConvertTo-Json -Depth 6
