import { Controller, Get, Query } from '@nestjs/common';
import { SymbolsService } from './symbols.service';

@Controller('api/symbols')
export class SymbolsController {
  constructor(private readonly symbolsService: SymbolsService) {}
  
  @Get()
  findSymbols(
    @Query('isListed') isListed: string,
    @Query('names') names: string
  ) {
    const params = { 
      isListed: isListed != undefined ? isListed != 'false' : undefined,
      names: names ? names.split(',') : undefined
    };

    return this.symbolsService.findSymbols(params);
  }

  @Get('statistics')
  getStatistics() {
    return this.symbolsService.getStatistics();
  }
}
