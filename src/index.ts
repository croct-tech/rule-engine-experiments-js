import engine from '@croct/plug-rule-engine/plugin';
import {PluginArguments} from '@croct/plug/plugin';
import ExperimentsExtension, {Definitions, definitionsSchema} from './extension';

declare module '@croct/plug-rule-engine/plugin' {
    export interface ExtensionConfigurations {
        experiments?: Definitions;
    }
}

engine.extend('experiments', ({options, sdk}: PluginArguments<Definitions>) => {
    definitionsSchema.validate(options);

    return new ExperimentsExtension(
        options,
        sdk.tracker,
        sdk.getBrowserStorage(),
        sdk.getTabStorage(),
        sdk.getLogger(),
    );
});
