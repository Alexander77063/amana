import { createNavigationContainerRef } from '@react-navigation/native';
import type { MainTabParamList } from './MainTabs';

/**
 * Root navigation ref, so a tapped push can navigate before any screen has mounted.
 *
 * The principal app has had one since 6b-3; the agent app had none, which is why its support
 * verification push had nowhere to go.
 */
export const navigationRef = createNavigationContainerRef<MainTabParamList>();
