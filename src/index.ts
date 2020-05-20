import engine from '@croct/plug-rule-engine/plugin';
import {PluginArguments} from '@croct/plug/plugin';
import ExperimentsExtension, {ExperimentDefinitions, ExperimentProperties, definitionsSchema} from './extension';

declare module '@croct/plug-rule-engine/plugin' {
    export interface ExtensionConfigurations {
        experiments?: ExperimentDefinitions;
    }
}

declare module '@croct/plug-rule-engine/rule' {
    export interface RuleProperties {
        experiments?: ExperimentProperties;
    }
}

engine.extend('experiments', ({options, sdk}: PluginArguments<ExperimentDefinitions>) => {
    definitionsSchema.validate(options);

    return new ExperimentsExtension(
        options,
        sdk.tracker,
        sdk.getBrowserStorage(),
        sdk.getTabStorage(),
        sdk.getLogger(),
    );
});
