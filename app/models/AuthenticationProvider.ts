import { computed, observable } from "mobx";
import { AuthenticationProviderSettings } from "@shared/types";
import Model from "./base/Model";
import Field from "./decorators/Field";

class AuthenticationProvider extends Model {
  static modelName = "AuthenticationProvider";

  displayName: string;

  name: string;

  @observable
  isConnected: boolean;

  @Field
  @observable
  isEnabled: boolean;

  @Field
  @observable
  settings: AuthenticationProviderSettings | null;

  @computed
  get isActive() {
    return this.isEnabled && this.isConnected;
  }
}

export default AuthenticationProvider;
