import engine from '@croct/plug-rule-engine/plugin';
import {PluginArguments} from '@croct/plug/plugin';
import ExperimentsExtension, {ExperimentDefinitions, ExperimentProperties} from './extension';
import {definitionsSchema} from './schemas';

declare module '@croct/plug-rule-engine/plugin' {
    export interface ExtensionConfigurations {
        experiments?: ExperimentDefinitions | false;
    }
}

declare module '@croct/plug-rule-engine/rule' {
    export interface RuleProperties {
        experiment?: ExperimentProperties;
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
