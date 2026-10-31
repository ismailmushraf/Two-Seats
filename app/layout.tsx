import type { Metadata, Viewport } from 'next';
import './globals.css';
export const metadata:Metadata={title:'Two Seats · A little closer',description:'Your private movie night. Two screens, one shared moment.',manifest:'/manifest.webmanifest',appleWebApp:{capable:true,statusBarStyle:'black-translucent',title:'Two Seats'},icons:{icon:'/icon.svg',apple:'/apple-icon.png'}};
export const viewport:Viewport={width:'device-width',initialScale:1,viewportFit:'cover',themeColor:'#101713'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
