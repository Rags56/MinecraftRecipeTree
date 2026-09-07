import React, {createContext, useContext, useState} from 'react';
import {Modal as NativeModal, Platform, View, type ModalProps} from 'react-native';

export const InterfaceScaleContext = createContext(1);
const RenderedScaleContext = createContext(1);
export function useRenderedScale(): number {return useContext(RenderedScaleContext);}

/** Native equivalent of CSS zoom: compensate layout dimensions before transforming. */
export function NativeUiScale({children}: {children: React.ReactNode}) {
  const scale = useContext(InterfaceScaleContext);
  const parentScale = useRenderedScale();
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  if (Platform.OS === 'web') return <>{children}</>;
  return (
    <View onLayout={event => setWidth(event.nativeEvent.layout.width)} style={{width: '100%', height: width && height ? height * scale : undefined}}>
      <RenderedScaleContext.Provider value={parentScale * scale}>
        <View onLayout={event => setHeight(event.nativeEvent.layout.height)} style={{width: width ? width / scale : '100%', transform: [{scale}], transformOrigin: 'top left'}}>
          {children}
        </View>
      </RenderedScaleContext.Provider>
    </View>
  );
}

/** Modal portals have their own native viewport, so they need their own scale frame. */
export function Modal({children, ...props}: ModalProps) {
  const scale = useContext(InterfaceScaleContext);
  const [size, setSize] = useState({width: 0, height: 0});
  if (Platform.OS === 'web') return <NativeModal {...props}>{children}</NativeModal>;
  return (
    <NativeModal {...props}>
      <View style={{flex: 1}} onLayout={event => setSize(event.nativeEvent.layout)}>
        <RenderedScaleContext.Provider value={scale}>
          <View style={{position: 'absolute', width: size.width / scale, height: size.height / scale, transform: [{scale}], transformOrigin: 'top left'}}>
            {children}
          </View>
        </RenderedScaleContext.Provider>
      </View>
    </NativeModal>
  );
}
