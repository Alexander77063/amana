// react-test-renderer's act() requires this flag to be set in non-DOM envs.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
